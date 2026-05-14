#let brand = rgb("#004c47")
#let brand-dark = rgb("#003a36")
#let accent = rgb("#c9ac67")
#let ink = rgb("#1a2b2a")
#let muted = rgb("#5f7472")
#let border = rgb("#c9d8d6")
#let panel = rgb("#f4f8f7")
#let row-alt = rgb("#f9fbfb")

#let fallback(value, default) = if value == none or value == "" { default } else { value }

#let args = if sys.inputs.at("args", default: none) == none {
  (:)
} else {
  json(sys.inputs.at("args"))
}

#let input-or-arg(name, default) = fallback(sys.inputs.at(name, default: none), args.at(name, default: default))
#let asset-or-arg(name, default) = fallback(sys.inputs.at(name, default: none), args.at(name, default: default))

#let report-id = input-or-arg("report_id", "-")
#let report-generated-at = input-or-arg("report_generated_at", "-")
#let report-location = input-or-arg("report_location", "-")
#let report-period = input-or-arg("report_period", "-")
#let report-lead = input-or-arg("report_lead", "-")
#let report-client = input-or-arg("report_client", "-")
#let report-client-role = input-or-arg("report_client_role", "-")
#let works-total = input-or-arg("works_total", "0 db")
#let flagged-total = input-or-arg("flagged_total", "0 db")

#let logo-path = asset-or-arg("logo_path", "../frontend/apps/main/public/Noma_logo_color_text_vertical.png")
#let lead-signature-path = asset-or-arg("lead_signature_path", none)
#let client-signature-path = asset-or-arg("client_signature_path", none)

#let workers = csv(input-or-arg("workers_csv", "munkalap_workers.csv"), row-type: dictionary)
#let rows = csv(input-or-arg("rows_csv", "munkalap_rows.csv"), row-type: dictionary)

#set page(
  paper: "a4",
  margin: (x: 10mm, y: 10mm),
  footer: context {
    let current = counter(page).get().first()
    let total = counter(page).final().first()

    if current == total [
      #align(right)[
        #text(size: 7.2pt, fill: muted)[Riport azonosító: #report-id · Generálva: #report-generated-at]
      ]
    ]
  },
)

#set document(title: "Munkalap")
#set text(
  lang: "hu",
  font: ("Carlito", "DejaVu Sans"),
  size: 9pt,
)

#let meta(label, value) = box(
  width: 100%,
  fill: white,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 6pt,
  inset: (x: 4mm, y: 2.5mm),
)[
  #text(size: 8pt, weight: "semibold", fill: muted)[#label]
  #v(0.9mm)
  #text(size: 10pt, weight: "bold", fill: ink)[#value]
]

#let stat(label, value) = box(
  width: 100%,
  fill: panel,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 6pt,
  inset: (x: 3mm, y: 2.2mm),
)[
  #text(size: 7.2pt, weight: "semibold", fill: muted)[#label]
  #v(0.6mm)
  #text(size: 10pt, weight: "bold", fill: brand-dark)[#value]
]

#let karb-mark(value) = if value == "CHECK" {
  [#text(size: 10pt, weight: "bold", fill: rgb("#0d7a3d"))[✓]]
} else {
  [#text(size: 10pt, weight: "bold", fill: rgb("#a22525"))[✗]]
}

#let work-cells = rows.map(row => (
  [#row.at("tipus")],
  [#row.at("device_code")],
  [#row.at("misc")],
  [#karb-mark(row.at("karb"))],
  [#row.at("feltart_hiba")],
  [#row.at("megjegyzes")],
)).flatten()

#box(
  width: 100%,
  fill: brand,
  radius: 10pt,
  inset: (x: 7mm, y: 5mm),
)[
  #grid(
    columns: (24mm, 1fr),
    gutter: 7mm,
    [
      #box(
        width: 100%,
        fill: white,
        radius: 6pt,
        inset: 2mm,
      )[
        #align(center)[
          #image(logo-path, width: 18mm)
        ]
      ]
    ],
    [
      #text(size: 8.5pt, fill: accent, weight: "bold")[NoMa Klíma- és Hűtéstechnikai Kft.]
      #v(1.2mm)
      #text(size: 22pt, fill: white, weight: "bold")[Karbantartási Munkalap]
    ],
  )
]

#v(3mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 4mm,
  [#meta([Helyszín], report-location)],
  [#meta([Munkavégzés ideje], report-period)],
)

#v(2.4mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 3mm,
  [#stat([Karbantartott berendezés], works-total)],
  [#stat([Feltárt hiba], flagged-total)],
)

#v(3mm)

#set text(size: 7.4pt)
#table(
  columns: (1.2fr, 0.95fr, 1.3fr, 0.55fr, 0.9fr, 1.3fr),
  align: (left, left, left, center, left, left),
  inset: (x: 2.2mm, y: 1.8mm),
  stroke: (paint: border, thickness: 0.7pt),
  fill: (x, y) => if y == 0 { brand-dark } else if calc.odd(y) { row-alt } else { white },
  table.header(
    [#text(fill: white, weight: "bold")[Típus]],
    [#text(fill: white, weight: "bold")[Berendezés kódja]],
    [#text(fill: white, weight: "bold")[Egyéb adat]],
    [#text(fill: white, weight: "bold")[Karb.]],
    [#text(fill: white, weight: "bold")[Feltárt hiba]],
    [#text(fill: white, weight: "bold")[Megjegyzés]],
  ),
  ..work-cells,
)

#set text(size: 9pt)
#v(2.8mm)

#set text(size: 8.4pt)
#table(
  columns: (1fr),
  stroke: (paint: border, thickness: 0.7pt),
  fill: (x, y) => if y == 0 { brand-dark } else if calc.odd(y) { row-alt } else { white },
  inset: (x: 3mm, y: 2mm),
  table.header([#text(fill: white, weight: "bold")[Munkavégzők neve]]),
  ..workers.map(worker => [#worker.at("name")]),
)

#set text(size: 9pt)
#v(2.2mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 6mm,
  [
    #box(
      width: 100%,
      height: 29mm,
      fill: panel,
      stroke: (paint: border, thickness: 0.7pt),
      radius: 7pt,
      inset: (x: 4mm, y: 3mm),
    )[
      #text(size: 7.5pt, weight: "semibold", fill: muted)[Műszakvezető neve, aláírása]
      #v(1mm)
      #if lead-signature-path == none or lead-signature-path == "" [
        #v(11mm)
      ] else [
        #align(center)[#image(lead-signature-path, width: 43mm)]
        #v(-1mm)
      ]
      #text(size: 8.2pt, weight: "bold", fill: ink)[#report-lead]
    ]
  ],
  [
    #box(
      width: 100%,
      height: 29mm,
      fill: panel,
      stroke: (paint: border, thickness: 0.7pt),
      radius: 7pt,
      inset: (x: 4mm, y: 3mm),
    )[
      #text(size: 7.5pt, weight: "semibold", fill: muted)[Megbízó képviselő neve, aláírása]
      #v(1mm)
      #if client-signature-path == none or client-signature-path == "" [
        #v(11mm)
      ] else [
        #align(center)[#image(client-signature-path, width: 43mm)]
        #v(-1mm)
      ]
      #text(size: 8.2pt, weight: "bold", fill: ink)[#report-client]
      #v(0.4mm)
      #text(size: 7.2pt, fill: muted)[#report-client-role]
    ]
  ],
)
