let recorder = null;
let chunks = [];
let stream = null;
let blob = null;

let ctx = null;
let source = null;
let analyser = null;
let raf = 0;

let timer = 0;
let startedAt = 0;

let selectedInputId = "";
let selectedOutputId = "";

let deviceChangeHandler = null;


function stopVisual() {
    cancelAnimationFrame(raf);

    raf = 0;

    source?.disconnect();
    analyser?.disconnect();

    ctx?.close().catch(() => {});

    source = null;
    analyser = null;
    ctx = null;
}


function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);

    const minutes = Math.floor(seconds / 60);

    const remainingSeconds = seconds % 60;

    return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(remainingSeconds).padStart(2, "0")
    );
}


function stopTimer(box) {
    clearInterval(timer);

    timer = 0;

    const elapsed = box.querySelector("#audioTimer");

    if (elapsed && startedAt) {
        elapsed.textContent =
            formatTime(Date.now() - startedAt);
    }
}


function startTimer(box) {
    startedAt = Date.now();

    const elapsed =
        box.querySelector("#audioTimer");

    if (elapsed) {
        elapsed.textContent = "00:00";
    }

    clearInterval(timer);

    timer = setInterval(() => {
        if (elapsed) {
            elapsed.textContent =
                formatTime(Date.now() - startedAt);
        }
    }, 250);
}


function draw(box) {
    const wave =
        box.querySelector(".audio-wave");

    const dot =
        box.querySelector(".audio-dot");

    if (!analyser || !wave || !dot) {
        return;
    }

    const data =
        new Uint8Array(analyser.fftSize);

    const loop = () => {
        if (!analyser) {
            return;
        }

        analyser.getByteTimeDomainData(data);

        let sum = 0;

        for (const value of data) {
            const n =
                (value - 128) / 128;

            sum += n * n;
        }

        const level =
            Math.min(
                1,
                Math.sqrt(sum / data.length) * 4
            );

        dot.classList.add("live");

        wave
            .querySelectorAll("i")
            .forEach((element, index) => {

                const position =
                    Math.floor(
                        index * data.length / 10
                    );

                const amplitude =
                    Math.abs(
                        data[position] - 128
                    ) / 128;

                element.style.height =
                    (
                        4 +
                        Math.max(
                            level,
                            amplitude
                        ) * 26
                    ) + "px";
            });

        raf =
            requestAnimationFrame(loop);
    };

    loop();
}


async function getDevices() {
    if (
        !navigator.mediaDevices?.enumerateDevices
    ) {
        return [];
    }

    try {
        return await navigator.mediaDevices.enumerateDevices();
    } catch {
        return [];
    }
}


function getDeviceLabel(
    device,
    index,
    type
) {
    if (device.label) {
        return device.label;
    }

    return type === "input"
        ? `Micrófono ${index + 1}`
        : `Salida de audio ${index + 1}`;
}


function updateSelectedLabels(box) {
    const input =
        box.querySelector("#audioInput");

    const output =
        box.querySelector("#audioOutput");

    const inputName =
        box.querySelector("#selectedInputName");

    const outputName =
        box.querySelector("#selectedOutputName");

    const activeInput =
        input?.options[input.selectedIndex];

    const activeOutput =
        output?.options[output.selectedIndex];

    if (inputName) {
        inputName.textContent =
            activeInput?.textContent ||
            "No seleccionado";
    }

    if (outputName) {
        outputName.textContent =
            activeOutput?.textContent ||
            "Salida predeterminada";
    }
}


function setTestStatus(
    box,
    text
) {
    const status =
        box.querySelector("#audioState");

    if (status) {
        status.textContent = text;
    }
}


async function refreshDeviceSelectors(box) {
    const inputSelect =
        box.querySelector("#audioInput");

    const outputSelect =
        box.querySelector("#audioOutput");

    if (
        !inputSelect ||
        !outputSelect
    ) {
        return;
    }

    const devices =
        await getDevices();

    const inputs =
        devices.filter(
            device =>
                device.kind === "audioinput"
        );

    const outputs =
        devices.filter(
            device =>
                device.kind === "audiooutput"
        );

    inputSelect.innerHTML = "";

    outputSelect.innerHTML = "";


    if (!inputs.length) {
        inputSelect.innerHTML =
            `
            <option value="">
                No se detectaron micrófonos
            </option>
            `;
    } else {
        inputs.forEach(
            (device, index) => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    device.deviceId;

                option.textContent =
                    getDeviceLabel(
                        device,
                        index,
                        "input"
                    );

                inputSelect.appendChild(
                    option
                );
            }
        );
    }


    if (!outputs.length) {
        outputSelect.innerHTML =
            `
            <option value="">
                Salida predeterminada del navegador
            </option>
            `;
    } else {
        outputs.forEach(
            (device, index) => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    device.deviceId;

                option.textContent =
                    getDeviceLabel(
                        device,
                        index,
                        "output"
                    );

                outputSelect.appendChild(
                    option
                );
            }
        );
    }


    if (
        selectedInputId &&
        inputs.some(
            device =>
                device.deviceId ===
                selectedInputId
        )
    ) {
        inputSelect.value =
            selectedInputId;

    } else if (inputs[0]) {

        selectedInputId =
            inputs[0].deviceId;

        inputSelect.value =
            selectedInputId;
    }


    if (
        selectedOutputId &&
        outputs.some(
            device =>
                device.deviceId ===
                selectedOutputId
        )
    ) {
        outputSelect.value =
            selectedOutputId;

    } else if (outputs[0]) {

        selectedOutputId =
            outputs[0].deviceId;

        outputSelect.value =
            selectedOutputId;
    }


    updateSelectedLabels(box);
}


async function selectInput(box) {
    const inputSelect =
        box.querySelector("#audioInput");

    const deviceId =
        inputSelect?.value;

    if (!deviceId) {
        return;
    }

    selectedInputId =
        deviceId;

    try {

        stream?.getTracks()
            .forEach(
                track =>
                    track.stop()
            );

        stopVisual();

        stream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: {
                        deviceId: {
                            exact: deviceId
                        }
                    }
                });


        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;


        if (AudioContext) {

            ctx =
                new AudioContext();

            source =
                ctx.createMediaStreamSource(
                    stream
                );

            analyser =
                ctx.createAnalyser();

            analyser.fftSize = 256;

            source.connect(
                analyser
            );

            draw(box);
        }


        updateSelectedLabels(box);

        setTestStatus(
            box,
            "Listo para grabar"
        );

    } catch {

        setTestStatus(
            box,
            "No se pudo utilizar este micrófono"
        );

        alert(
            "No se pudo utilizar la diadema seleccionada. " +
            "Comprueba que esté conectada y que Chrome tenga permiso para utilizarla."
        );
    }
}


async function selectOutput(box) {
    const outputSelect =
        box.querySelector("#audioOutput");

    const player =
        box.querySelector("#player");

    const deviceId =
        outputSelect?.value;

    if (
        !deviceId ||
        !player
    ) {
        return;
    }

    selectedOutputId =
        deviceId;

    updateSelectedLabels(box);


    if (
        typeof player.setSinkId ===
        "function"
    ) {

        try {

            await player.setSinkId(
                deviceId
            );

            const outputName =
                box.querySelector(
                    "#selectedOutputName"
                )?.textContent ||
                "salida seleccionada";

            const state =
                box.querySelector(
                    "#outputState"
                );

            if (state) {
                state.textContent =
                    `Salida activa: ${outputName}`;
            }

        } catch {

            const state =
                box.querySelector(
                    "#outputState"
                );

            if (state) {
                state.textContent =
                    "No se pudo cambiar la salida. " +
                    "Se utilizará la salida predeterminada.";
            }
        }
    }
}


function renderControls(box) {

    box.innerHTML = `

        <div class="audio-device-panel">

            <div class="audio-device-field">

                <label for="audioInput">
                    🎤 Micrófono
                </label>

                <select id="audioInput">
                    <option>
                        Detectando dispositivos…
                    </option>
                </select>

            </div>


            <div class="audio-device-field">

                <label for="audioOutput">
                    🔊 Salida
                </label>

                <select id="audioOutput">
                    <option>
                        Detectando dispositivos…
                    </option>
                </select>

            </div>

        </div>


        <div class="audio-live">

            <span class="audio-dot"></span>

            <div class="audio-live-copy">

                <strong id="audioState">
                    Listo para probar
                </strong>

                <span id="audioTimer">
                    00:00
                </span>

            </div>


            <div class="audio-wave">

                ${
                    Array.from(
                        { length: 14 },
                        () => "<i></i>"
                    ).join("")
                }

            </div>

        </div>


        <div class="audio-main-action">

            <button
                id="rec"
                type="button"
                class="primary audio-record-button"
            >
                🎙️ Iniciar grabación
            </button>


            <button
                id="del"
                type="button"
                class="audio-delete"
                aria-label="Eliminar grabación"
                title="Eliminar grabación"
            >
                ×
            </button>

        </div>


        <audio
            id="player"
            controls
            class="full audio-player"
        ></audio>


        <div
            id="outputState"
            class="audio-device-status"
        ></div>

    `;
}


export async function audioTest(
    box,
    cb = () => {}
) {

    try {

        if (
            !navigator.mediaDevices?.getUserMedia
        ) {
            throw new Error(
                "El navegador no permite acceder al audio."
            );
        }


        stream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: true
                });


        renderControls(box);


        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;


        if (AudioContext) {

            ctx =
                new AudioContext();

            source =
                ctx.createMediaStreamSource(
                    stream
                );

            analyser =
                ctx.createAnalyser();

            analyser.fftSize = 256;

            source.connect(
                analyser
            );

            draw(box);
        }


        await refreshDeviceSelectors(
            box
        );


        const inputSelect =
            box.querySelector(
                "#audioInput"
            );

        const outputSelect =
            box.querySelector(
                "#audioOutput"
            );

        const rec =
            box.querySelector("#rec");

        const del =
            box.querySelector("#del");

        const player =
            box.querySelector("#player");

        const state =
            box.querySelector(
                "#audioState"
            );

        const dot =
            box.querySelector(
                ".audio-dot"
            );


        inputSelect.onchange =
            async () => {

                updateSelectedLabels(
                    box
                );

                await selectInput(
                    box
                );
            };


        outputSelect.onchange =
            async () => {

                updateSelectedLabels(
                    box
                );

                await selectOutput(
                    box
                );
            };


        deviceChangeHandler =
            async () => {

                await refreshDeviceSelectors(
                    box
                );

                if (
                    selectedInputId &&
                    !box.querySelector(
                        "#audioInput"
                    )?.value
                ) {

                    setTestStatus(
                        box,
                        "La diadema seleccionada ya no está conectada"
                    );
                }
            };


        navigator.mediaDevices
            .addEventListener?.(
                "devicechange",
                deviceChangeHandler
            );


        rec.onclick =
            async () => {

                if (
                    recorder?.state ===
                    "recording"
                ) {

                    recorder.stop();

                    return;
                }


                if (
                    !stream ||
                    !stream.active
                ) {

                    await selectInput(
                        box
                    );
                }


                if (
                    !stream?.active
                ) {
                    return;
                }


                chunks = [];

                blob = null;


                recorder =
                    new MediaRecorder(
                        stream
                    );


                recorder.ondataavailable =
                    event => {

                        if (
                            event.data.size
                        ) {
                            chunks.push(
                                event.data
                            );
                        }
                    };


                recorder.onstop =
                    () => {

                        stopTimer(
                            box
                        );


                        blob =
                            new Blob(
                                chunks,
                                {
                                    type:
                                        recorder.mimeType ||
                                        "audio/webm"
                                }
                            );


                        player.src =
                            URL.createObjectURL(
                                blob
                            );


                        rec.textContent =
                            "🎙️ Grabar de nuevo";


                        state.textContent =
                            "Grabación lista para reproducir";


                        dot.classList.remove(
                            "live"
                        );


                        cb("Sí");
                    };


                recorder.start();


                startTimer(
                    box
                );


                rec.textContent =
                    "⏹ Parar grabación";


                state.textContent =
                    "Grabando… habla para comprobar el micrófono";


                dot.classList.add(
                    "live"
                );


                setTimeout(
                    () => {

                        if (
                            recorder?.state ===
                            "recording"
                        ) {
                            recorder.stop();
                        }

                    },
                    45000
                );
            };


        del.onclick =
            () => {

                if (
                    recorder?.state ===
                    "recording"
                ) {
                    recorder.stop();
                }


                blob = null;


                player.removeAttribute(
                    "src"
                );

                player.load();


                stopTimer(
                    box
                );


                rec.textContent =
                    "🎙️ Iniciar grabación";


                state.textContent =
                    "Listo para probar";


                dot.classList.remove(
                    "live"
                );


                cb("No");
            };


        stream.getTracks()
            .forEach(
                track => {

                    track.addEventListener(
                        "ended",
                        () => {

                            state.textContent =
                                "⚠️ La diadema fue desconectada";

                            dot.classList.remove(
                                "live"
                            );
                        }
                    );
                }
            );

    } catch {

        box.innerHTML =
            `
            <span class="muted">
                No se pudo iniciar el test de audio.
                Puedes omitirlo.
            </span>
            `;

        cb("Omitido");
    }
}


export function cleanupAudio() {

    clearInterval(timer);

    timer = 0;


    if (
        recorder?.state ===
        "recording"
    ) {
        recorder.stop();
    }


    stopVisual();


    stream?.getTracks()
        .forEach(
            track =>
                track.stop()
        );


    if (
        navigator.mediaDevices &&
        deviceChangeHandler
    ) {

        navigator.mediaDevices
            .removeEventListener(
                "devicechange",
                deviceChangeHandler
            );
    }


    deviceChangeHandler =
        null;

    stream = null;

    recorder = null;

    blob = null;

    chunks = [];

    selectedInputId = "";

    selectedOutputId = "";
}