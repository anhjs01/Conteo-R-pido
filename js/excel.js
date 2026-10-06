export function rows(u) {
  return u.map(x => ({
    "N°": x.sequence,
    "Ticket": x.ticket || "",
    "ID": x.unitId || "",
    "Fabricante": x.manufacturer || "",
    "Fecha del lote": x.lotDate || "",
    "Tipo de lectura": x.readType || "",
    "Cantidad": 1,
    "Estado diagnóstico": x.diagnosis || "",
    "Reparable":
      x.repairable === true
        ? "Sí"
        : x.repairable === false
          ? "No"
          : "",
    "Motivo no reparable":
      (x.noRepairReasons || []).join(" + "),
    "Reparación / mantenimiento":
      (x.repairs || []).join(" + "),
    "Observaciones":
      x.observations || "",
    "Empaque":
      x.packaging || ""
  }));
}

export async function exportExcel(u) {
  if (!window.XLSX) {
    return alert("Excel aún no está disponible.");
  }

  const data = rows(u);

  const ws =
    XLSX.utils.json_to_sheet(data);

  const wb =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    "Inventario"
  );

  const range =
    XLSX.utils.decode_range(ws["!ref"]);

  /*
    Encabezados
  */
  for (
    let c = range.s.c;
    c <= range.e.c;
    c++
  ) {
    const cell =
      ws[
        XLSX.utils.encode_cell({
          r: 0,
          c
        })
      ];

    if (cell) {
      cell.s = {
        font: {
          bold: true,
          color: {
            rgb: "FFFFFF"
          }
        },
        fill: {
          fgColor: {
            rgb: "0F172A"
          }
        },
        alignment: {
          vertical: "center",
          horizontal: "center",
          wrapText: true
        }
      };
    }
  }

  /*
    Colores según estado
  */
  for (
    let r = 1;
    r <= range.e.r;
    r++
  ) {
    const row =
      data[r - 1];

    const fill =
      row["Estado diagnóstico"] ===
      "No reparable"
        ? "FECACA"
        : row.Empaque ===
          "Empacado"
          ? "BBF7D0"
          : row.Empaque ===
            "Listo para empacar"
            ? "FEF08A"
            : null;

    if (!fill) {
      continue;
    }

    for (
      let c = range.s.c;
      c <= range.e.c;
      c++
    ) {
      const cell =
        ws[
          XLSX.utils.encode_cell({
            r,
            c
          })
        ];

      if (cell) {
        cell.s = {
          fill: {
            fgColor: {
              rgb: fill
            }
          },
          alignment: {
            vertical: "top",
            wrapText: true
          }
        };
      }
    }
  }

  /*
    Alineación general
  */
  for (const k of Object.keys(ws)) {
    if (k[0] !== "!") {
      ws[k].s = {
        ...(ws[k].s || {}),
        alignment: {
          ...(ws[k].s?.alignment || {}),
          vertical: "top",
          wrapText: true
        }
      };
    }
  }

  /*
    Ancho de columnas
  */
  ws["!cols"] =
    Object.keys(
      data[0] || {
        "N°": ""
      }
    ).map(k => ({
      wch: Math.min(
        36,
        Math.max(10, k.length + 2)
      )
    }));

  XLSX.writeFile(
    wb,
    "conteo-rapido.xlsx"
  );
}

/*
  ============================================================
  IMPORTAR EXCEL
  ============================================================
*/

function clean(value) {
  return String(value ?? "").trim();
}

function splitValues(value) {
  return clean(value)
    .split("+")
    .map(x => x.trim())
    .filter(Boolean);
}

function parseRepairable(value, diagnosis) {
  const v =
    clean(value).toLowerCase();

  if (
    v === "sí" ||
    v === "si" ||
    v === "yes" ||
    v === "true"
  ) {
    return true;
  }

  if (
    v === "no" ||
    v === "false"
  ) {
    return false;
  }

  return diagnosis !== "No reparable";
}

function normalizeDiagnosis(value) {
  const v =
    clean(value).toLowerCase();

  if (
    v === "no reparable" ||
    v === "no reparable "
  ) {
    return "No reparable";
  }

  return "Reparable";
}

/**
 * Convierte una fila del Excel exportado por
 * Conteo Rápido a una unidad de inventario.
 */
export function rowToUnit(row, index, lot) {
  const diagnosis =
    normalizeDiagnosis(
      row["Estado diagnóstico"]
    );

  const unitId =
    clean(row["ID"]);

  if (!unitId) {
    throw new Error(
      `La fila ${index + 2} no tiene ID.`
    );
  }

  const repairs =
    diagnosis === "No reparable"
      ? []
      : splitValues(
          row[
            "Reparación / mantenimiento"
          ]
        );

  const reasons =
    diagnosis === "No reparable"
      ? splitValues(
          row[
            "Motivo no reparable"
          ]
        )
      : [];

  return {
    id:
      "unit-" +
      crypto.randomUUID(),

    unitId,

    sequence:
      index + 1,

    ticket:
      clean(row["Ticket"]),

    manufacturer:
      clean(row["Fabricante"]) ||
      "Pendiente",

    lotDate:
      clean(row["Fecha del lote"]) ||
      lot.date,

    readType:
      clean(row["Tipo de lectura"]) ||
      "Importado desde Excel",

    diagnosis,

    repairable:
      parseRepairable(
        row["Reparable"],
        diagnosis
      ),

    noRepairReasons:
      reasons,

    repairs,

    observations:
      clean(row["Observaciones"]),

    packaging:
      clean(row["Empaque"]) ||
      "Listo para empacar",

    lotId:
      lot.id,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString(),

    importedFromExcel: true
  };
}

/**
 * Importa un Excel y devuelve los datos preparados.
 *
 * Esta función NO escribe directamente en IndexedDB.
 * app.js se encarga de crear el lote y guardar los registros.
 */
export async function readExcelFile(file) {
  if (!window.XLSX) {
    throw new Error(
      "La biblioteca de Excel todavía no está disponible."
    );
  }

  if (!file) {
    throw new Error(
      "No se seleccionó ningún archivo."
    );
  }

  const valid =
    /\.(xlsx|xls)$/i.test(
      file.name
    );

  if (!valid) {
    throw new Error(
      "Selecciona un archivo Excel (.xlsx o .xls)."
    );
  }

  const buffer =
    await file.arrayBuffer();

  const workbook =
    XLSX.read(buffer, {
      type: "array"
    });

  if (
    !workbook.SheetNames.length
  ) {
    throw new Error(
      "El archivo Excel no contiene hojas."
    );
  }

  /*
    Utilizamos la primera hoja.
    Es la hoja "Inventario" que genera
    Conteo Rápido.
  */
  const sheet =
    workbook.Sheets[
      workbook.SheetNames[0]
    ];

  const rows =
    XLSX.utils.sheet_to_json(
      sheet,
      {
        defval: ""
      }
    );

  if (!rows.length) {
    throw new Error(
      "El Excel está vacío."
    );
  }

  const requiredColumns = [
    "ID"
  ];

  const columns =
    Object.keys(rows[0]);

  for (const column of requiredColumns) {
    if (!columns.includes(column)) {
      throw new Error(
        `El Excel no tiene la columna "${column}".`
      );
    }
  }

  return {
    fileName: file.name,
    sheetName:
      workbook.SheetNames[0],
    rows
  };
}

export function exportCsv(u) {
  const d = rows(u);

  const k =
    Object.keys(
      d[0] || {
        "N°": ""
      }
    );

  const e = value =>
    String(value ?? "")
      .replaceAll('"', '""');

  const c =
    "\ufeff" +
    k
      .map(
        x =>
          '"' +
          e(x) +
          '"'
      )
      .join(",") +
    "\n" +
    d
      .map(r =>
        k
          .map(
            x =>
              '"' +
              e(r[x]) +
              '"'
          )
          .join(",")
      )
      .join("\n");

  download(
    new Blob(
      [c],
      {
        type:
          "text/csv;charset=utf-8"
      }
    ),
    "conteo-rapido.csv"
  );
}

export function exportJson(x) {
  download(
    new Blob(
      [
        JSON.stringify(
          x,
          null,
          2
        )
      ],
      {
        type:
          "application/json"
      }
    ),
    "conteo-rapido-backup.json"
  );
}

function download(blob, name) {
  const a =
    document.createElement("a");

  a.href =
    URL.createObjectURL(blob);

  a.download = name;

  a.click();

  setTimeout(
    () =>
      URL.revokeObjectURL(
        a.href
      ),
    1000
  );
}