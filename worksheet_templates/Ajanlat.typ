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
  json(bytes(sys.inputs.at("args")))
}

#let input-or-arg(name, default) = fallback(sys.inputs.at(name, default: none), args.at(name, default: default))
#let asset-or-arg(name, default) = fallback(sys.inputs.at(name, default: none), args.at(name, default: default))

#let proposal-id = input-or-arg("proposal_id", "-")
#let proposal-generated-at = input-or-arg("proposal_generated_at", "-")
#let proposal-created-at = input-or-arg("proposal_created_at", "-")
#let proposal-created-by = input-or-arg("proposal_created_by", "-")
#let proposal-building-address = input-or-arg("proposal_building_address", "-")
#let proposal-device-name = input-or-arg("proposal_device_name", "-")
#let proposal-device-type = input-or-arg("proposal_device_type", "-")
#let proposal-device-brand-model = input-or-arg("proposal_device_brand_model", "-")
#let proposal-device-identifier = input-or-arg("proposal_device_identifier", "-")
#let proposal-device-location = input-or-arg("proposal_device_location", "-")
#let proposal-net-price = input-or-arg("proposal_net_price", "0 Ft")
#let proposal-note = input-or-arg("proposal_note", "")
#let proposal-external-issue-number = input-or-arg("proposal_external_issue_number", "")
#let logo-path = asset-or-arg("logo_path", "../frontend/apps/main/public/Noma_logo_color_text_vertical.png")

#let lines = args.at("lines", default: ())

#let meta(label, value) = box(
  width: 100%,
  fill: white,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 6pt,
  inset: (x: 4mm, y: 2.5mm),
)[
  #text(size: 7.9pt, weight: "semibold", fill: muted)[#label]
  #v(0.9mm)
  #text(size: 10.2pt, weight: "bold", fill: ink)[#value]
]

#let line-cells = lines.map(line => (
  [#line.at("position")],
  [#line.at("item")],
  [#line.at("quantity")],
  [#line.at("uom")],
  [#line.at("net_unit_price")~Ft],
  [#line.at("line_total")~Ft],
)).flatten()

#set page(
  paper: "a4",
  margin: (x: 10mm, y: 10mm),
  footer: context {
    let current = counter(page).get().first()
    let total = counter(page).final().first()

    if current == total [
      #align(right)[
        #text(size: 7.2pt, fill: muted)[Ajánlat azonosító: #proposal-id · Generálva: #proposal-generated-at]
      ]
    ]
  },
)

#set document(title: "Ajánlat")
#set text(
  lang: "hu",
  font: ("Carlito", "DejaVu Sans"),
  size: 9pt,
)

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
      #grid(
        columns: (1fr, auto),
        gutter: 4mm,
        [
          #text(size: 8.5pt, fill: accent, weight: "bold")[NoMa Klíma- és Hűtéstechnikai Kft.]
          #v(1.2mm)
          #text(size: 22pt, fill: white, weight: "bold")[Ajánlat]
        ],
        [
          #if proposal-external-issue-number != "" [
            #box(
              fill: white,
              radius: 6pt,
              inset: (x: 3mm, y: 2mm),
            )[
              #text(size: 7.2pt, weight: "semibold", fill: muted)[Igénylési szám]
              #v(0.5mm)
              #text(size: 9.8pt, weight: "bold", fill: ink)[#proposal-external-issue-number]
            ]
          ]
        ],
      )
    ],
  )
]
#v(3mm)

#meta([Épület címe], proposal-building-address)

#v(2.6mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 4mm,
  [#meta([Azonosító], proposal-device-identifier)],
  [#meta([Típus], proposal-device-type)],
  [#meta([Márka / modell], proposal-device-brand-model)],
  [#meta([Elhelyezkedés], proposal-device-location)],
)

#v(2.6mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 4mm,
  [#meta([Kelt], proposal-created-at)],
  [#meta([Készítette], proposal-created-by)],
)

#v(2.8mm)

#set text(size: 7.8pt)
#if lines.len() == 0 [
  #box(
    width: 100%,
    fill: white,
    stroke: (paint: border, thickness: 0.7pt),
    radius: 6pt,
    inset: (x: 4mm, y: 3mm),
  )[
    #text(size: 8.2pt, fill: muted)[Nincsenek megadott tételek.]
  ]
] else [
  #table(
    columns: (0.55fr, 2.8fr, 0.8fr, 0.8fr, 1fr, 1fr),
    align: (center, left, right, left, right, right),
    inset: (x: 2.2mm, y: 1.8mm),
    stroke: (paint: border, thickness: 0.7pt),
    fill: (x, y) => if y == 0 { brand-dark } else if calc.odd(y) { row-alt } else { white },
    table.header(
      [#text(fill: white, weight: "bold")[Ssz.]],
      [#text(fill: white, weight: "bold")[Tétel]],
      [#text(fill: white, weight: "bold")[Menny.]],
      [#text(fill: white, weight: "bold")[Egység]],
      [#text(fill: white, weight: "bold")[Nettó egységár]],
      [#text(fill: white, weight: "bold")[Nettó érték]],
    ),
    ..line-cells,
  )
]

#v(3mm)

#grid(
  columns: (1.4fr, 1fr),
  gutter: 5mm,
  [
    #box(
      width: 100%,
      height: 28mm,
      fill: panel,
      stroke: (paint: border, thickness: 0.7pt),
      radius: 7pt,
      inset: (x: 4mm, y: 3mm),
    )[
      #text(size: 7.5pt, weight: "semibold", fill: muted)[Megjegyzés]
      #v(1mm)
      #text(size: 8.2pt, fill: ink)[#proposal-note]
    ]
  ],
  [
    #box(
      width: 100%,
      height: 28mm,
      fill: panel,
      stroke: (paint: border, thickness: 0.7pt),
      radius: 7pt,
      inset: (x: 4mm, y: 3mm),
    )[
      #text(size: 7.5pt, weight: "semibold", fill: muted)[Nettó érték összesen]
      #v(1mm)
      #text(size: 12pt, weight: "bold", fill: ink)[#proposal-net-price]
    ]
  ],
)
