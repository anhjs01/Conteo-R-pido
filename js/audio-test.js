let recorder = null;
let chunks = [];
let stream = null;
let blob = null;
let ctx = null;
let source = null;
let analyser = null;
let raf = 0;

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

function draw(box) {
  const wave = box.querySelector(".audio-wave");
  const dot = box.querySelector(".audio-dot");

  if (!analyser || !wave || !dot) return;

  const data = new Uint8Array(analyser.fftSize);

  const loop = () => {
    if (!analyser) return;

    analyser.getByteTimeDomainData(data);

    let sum = 0;

    for (const value of data) {
      const n = (value - 128) / 128;
      sum += n * n;
    }

    const level = Math.min(
      1,
      Math.sqrt(sum / data.length) * 4
    );

    dot.classList.add("live");

    wave.querySelectorAll("i").forEach((element, index) => {
      const position = Math.floor(
        index * data.length / 10
      );

      const amplitude =
        Math.abs(data[position] - 128) / 128;

      element.style.height =
        (4 + Math.max(level, amplitude) * 26) + "px";
    });

    raf = requestAnimationFrame(loop);
  };

  loop();
}

async function getDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
}

function getDeviceLabel(device, index, type) {
  if (device.label) {
    return device.label;
  }

  if (type === "input") {
    return `Micrófono ${index + 1}`;
  }

  return `Salida de audio ${index + 1}`;
}

function updateSelectedLabels(box) {
  const input = box.querySelector("#audioInput");
  const output = box.querySelector("#audioOutput");

  const inputName = box.querySelector("#selectedInputName");
  const outputName = box.querySelector("#selectedOutputName");

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

function setTestStatus(box, text) {
  const status = box.querySelector("#audioState");

  if (status) {
    status.textContent = text;
  }
}

async function refreshDeviceSelectors(box) {
  const inputSelect =
    box.querySelector("#audioInput");

  const outputSelect =
    box.querySelector("#audioOutput");

  if (!inputSelect || !outputSelect) {
    return;
  }

  const devices = await getDevices();

  const inputs =
    devices.filter(
      device => device.kind === "audioinput"
    );

  const outputs =
    devices.filter(
      device => device.kind === "audiooutput"
    );

  inputSelect.innerHTML = "";

  outputSelect.innerHTML = "";

  if (!inputs.length) {
    inputSelect.innerHTML =
      `<option value="">
        No se detectaron micrófonos
      </option>`;
  } else {
    inputs.forEach((device, index) => {
      const option =
        document.createElement("option");

      option.value = device.deviceId;

      option.textContent =
        getDeviceLabel(device, index, "input");

      inputSelect.appendChild(option);
    });
  }

  if (!outputs.length) {
    outputSelect.innerHTML =
      `<option value="">
        Salida predeterminada del navegador
      </option>`;
  } else {
    outputs.forEach((device, index) => {
      const option =
        document.createElement("option");

      option.value = device.deviceId;

      option.textContent =
        getDeviceLabel(device, index, "output");

      outputSelect.appendChild(option);
    });
  }

  if (
    selectedInputId &&
    inputs.some(
      device =>
        device.deviceId === selectedInputId
    )
  ) {
    inputSelect.value = selectedInputId;
  } else if (inputs[0]) {
    selectedInputId = inputs[0].deviceId;
    inputSelect.value = selectedInputId;
  }

  if (
    selectedOutputId &&
    outputs.some(
      device =>
        device.deviceId === selectedOutputId
    )
  ) {
    outputSelect.value = selectedOutputId;
  } else if (outputs[0]) {
    selectedOutputId = outputs[0].deviceId;
    outputSelect.value = selectedOutputId;
  }

  updateSelectedLabels(box);
}

async function selectInput(box) {
  const inputSelect =
    box.querySelector("#audioInput");

  const deviceId = inputSelect?.value;

  if (!deviceId) {
    return;
  }

  selectedInputId = deviceId;

  try {
    stream?.getTracks().forEach(
      track => track.stop()
    );

    stopVisual();

    stream =
      await navigator.mediaDevices.getUserMedia({
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
      ctx = new AudioContext();

      source =
        ctx.createMediaStreamSource(stream);

      analyser =
        ctx.createAnalyser();

      analyser.fftSize = 256;

      source.connect(analyser);

      draw(box);
    }

    updateSelectedLabels(box);

    const inputName =
      box.querySelector("#selectedInputName")
        ?.textContent ||
      "dispositivo seleccionado";

    setTestStatus(
      box,
      `Probando: ${inputName}`
    );

  } catch (error) {
    setTestStatus(
      box,
      "No se pudo utilizar este dispositivo"
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

  if (!deviceId || !player) {
    return;
  }

  selectedOutputId = deviceId;

  updateSelectedLabels(box);

  if (typeof player.setSinkId === "function") {
    try {
      await player.setSinkId(deviceId);

      const outputName =
        box.querySelector("#selectedOutputName")
          ?.textContent ||
        "salida seleccionada";

      const state =
        box.querySelector("#outputState");

      if (state) {
        state.textContent =
          `Salida activa: ${outputName}`;
      }

    } catch {
      const state =
        box.querySelector("#outputState");

      if (state) {
        state.textContent =
          "No se pudo cambiar la salida. Se utilizará la salida predeterminada.";
      }
    }
  } else {
    const state =
      box.querySelector("#outputState");

    if (state) {
      state.textContent =
        "Chrome utiliza la salida predeterminada del sistema.";
    }
  }
}

export async function audioTest(box, cb) {
  try {
    if (
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error(
        "El navegador no permite acceder al audio."
      );
    }

    /*
      Primero pedimos permiso.
      Esto permite que Chrome revele
      los nombres reales de los dispositivos.
    */

    stream =
      await navigator.mediaDevices.getUserMedia({
        audio: true
      });

    box.innerHTML = `
      <div class="audio-device-panel">

        <div class="audio-device-title">
          🎧 <strong>Dispositivo de prueba</strong>
        </div>

        <div class="audio-device-field">

          <label for="audioInput">
            🎤 Entrada / micrófono
          </label>

          <select id="audioInput">
            <option>
              Detectando dispositivos…
            </option>
          </select>

          <small>
            Selecciona la diadema que quieres probar.
          </small>

          <div class="audio-selected">
            🟢 Probando entrada:
            <strong id="selectedInputName">
              Detectando…
            </strong>
          </div>

        </div>

        <div class="audio-device-field">

          <label for="audioOutput">
            🔊 Salida / auriculares
          </label>

          <select id="audioOutput">
            <option>
              Detectando dispositivos…
            </option>
          </select>

          <small>
            Esta será la salida utilizada para escuchar
            la grabación cuando Chrome lo permita.
          </small>

          <div class="audio-selected">
            🔵 Salida seleccionada:
            <strong id="selectedOutputName">
              Detectando…
            </strong>
          </div>

          <div
            id="outputState"
            class="audio-device-status"
          ></div>

        </div>

        <button
          id="refreshDevices"
          type="button"
          class="secondary"
        >
          🔄 Actualizar dispositivos
        </button>

      </div>

      <div class="audio-live">

        <span class="audio-dot"></span>

        <strong id="audioState">
          Detectando dispositivo…
        </strong>

        <div class="audio-wave">
          ${Array.from(
            { length: 10 },
            () => "<i></i>"
          ).join("")}
        </div>

      </div>

      <div class="audio-actions">

        <button
          id="rec"
          class="primary"
        >
          🔴 Grabar
        </button>

        <button id="stop">
          ⏹ Detener
        </button>

        <button id="listen">
          ▶ Escuchar
        </button>

        <button
          id="del"
          class="danger"
        >
          Eliminar
        </button>

      </div>

      <audio
        id="player"
        controls
        class="full"
      ></audio>
    `;

    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (AudioContext) {
      ctx = new AudioContext();

      source =
        ctx.createMediaStreamSource(stream);

      analyser =
        ctx.createAnalyser();

      analyser.fftSize = 256;

      source.connect(analyser);

      draw(box);
    }

    await refreshDeviceSelectors(box);

    const inputSelect =
      box.querySelector("#audioInput");

    const outputSelect =
      box.querySelector("#audioOutput");

    const refreshButton =
      box.querySelector("#refreshDevices");

    inputSelect.onchange = async () => {
      updateSelectedLabels(box);
      await selectInput(box);
    };

    outputSelect.onchange = async () => {
      updateSelectedLabels(box);
      await selectOutput(box);
    };

    refreshButton.onclick = async () => {
      await refreshDeviceSelectors(box);

      setTestStatus(
        box,
        "Dispositivos actualizados"
      );
    };

    /*
      Detectamos conexiones y desconexiones.
    */

    deviceChangeHandler = async () => {
      await refreshDeviceSelectors(box);

      const currentInput =
        box.querySelector("#audioInput");

      if (
        selectedInputId &&
        currentInput &&
        currentInput.value !== selectedInputId
      ) {
        setTestStatus(
          box,
          "La diadema seleccionada ya no está conectada"
        );
      }
    };

    navigator.mediaDevices.addEventListener?.(
      "devicechange",
      deviceChangeHandler
    );

    /*
      Botones de grabación.
    */

    const rec =
      box.querySelector("#rec");

    const stop =
      box.querySelector("#stop");

    const listen =
      box.querySelector("#listen");

    const del =
      box.querySelector("#del");

    const player =
      box.querySelector("#player");

    const state =
      box.querySelector("#audioState");

    rec.onclick = () => {
      if (
        recorder?.state === "recording"
      ) {
        return;
      }

      chunks = [];

      recorder =
        new MediaRecorder(stream);

      recorder.ondataavailable = event => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        blob =
          new Blob(chunks, {
            type:
              recorder.mimeType ||
              "audio/webm"
          });

        player.src =
          URL.createObjectURL(blob);

        state.textContent =
          "Prueba grabada correctamente";

        cb("Sí");
      };

      recorder.start();

      state.textContent =
        "Grabando… habla para comprobar la diadema";

      rec.disabled = true;

      setTimeout(() => {
        if (
          recorder?.state === "recording"
        ) {
          recorder.stop();
          rec.disabled = false;
        }
      }, 45000);
    };

    stop.onclick = () => {
      if (
        recorder?.state === "recording"
      ) {
        recorder.stop();
      }

      rec.disabled = false;
    };

    listen.onclick = async () => {
      try {
        await selectOutput(box);

        await player.play();

      } catch {
        state.textContent =
          "No se pudo reproducir la grabación";
      }
    };

    del.onclick = () => {
      blob = null;

      player.removeAttribute("src");
      player.load();

      state.textContent =
        "Sin grabación";

      cb("No");
    };

    stream.getTracks().forEach(track => {
      track.addEventListener(
        "ended",
        () => {
          state.textContent =
            "⚠️ La diadema fue desconectada";
        }
      );
    });

  } catch (error) {
    box.innerHTML = `
      <span class="muted">
        No se pudo iniciar el test de audio.
        Puedes omitirlo.
      </span>
    `;

    cb("Omitido");
  }
}

export function cleanupAudio() {
  if (
    recorder?.state === "recording"
  ) {
    recorder.stop();
  }

  stopVisual();

  stream?.getTracks().forEach(
    track => track.stop()
  );

  if (
    navigator.mediaDevices &&
    deviceChangeHandler
  ) {
    navigator.mediaDevices.removeEventListener(
      "devicechange",
      deviceChangeHandler
    );
  }

  deviceChangeHandler = null;

  stream = null;
  blob = null;

  selectedInputId = "";
  selectedOutputId = "";
}