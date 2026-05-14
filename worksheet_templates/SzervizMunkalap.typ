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
#let service-date = input-or-arg("service_date", input-or-arg("maintenance_date", "-"))
#let device-code = input-or-arg("device_code", input-or-arg("source_device_code", "-"))
#let issue-number = input-or-arg("issue_number", input-or-arg("reference_number", "-"))
#let building-address = input-or-arg("building_address", input-or-arg("report_location", "-"))
#let building-code = input-or-arg("building_code", "-")
#let room = input-or-arg("room", input-or-arg("room_path", "-"))
#let device-type = input-or-arg("device_type", "-")
#let explicit-brand-model = input-or-arg("brand_model", none)
#let device-brand = input-or-arg("device_brand", "")
#let device-model = input-or-arg("device_model", "")
#let brand-model = if explicit-brand-model != none and explicit-brand-model != "" {
  explicit-brand-model
} else if device-brand != "" and device-model != "" {
  [#device-brand / #device-model]
} else if device-brand != "" {
  device-brand
} else if device-model != "" {
  device-model
} else {
  "-"
}
#let maintainer = input-or-arg("maintainer", input-or-arg("report_lead", "-"))
#let note = input-or-arg("note", input-or-arg("extra_note", "-"))
#let referent-name = input-or-arg("referent_name", input-or-arg("report_client", "-"))
#let referent-role = input-or-arg("referent_role", input-or-arg("report_client_role", "-"))
#let logo-path = asset-or-arg("logo_path", "../frontend/apps/main/public/Noma_logo_color_text_vertical.png")
#let referent-signature-path = asset-or-arg(
  "referent_signature_path",
  fallback(asset-or-arg("client_signature_path", none), none),
)
#let photos = args.at("photos", default: args.at("images", default: ()))

#set page(
  paper: "a4",
  margin: (x: 7mm, y: 7mm),
  header: context {
    let current = counter(page).get().first()

    if current > 1 [
      #align(right)[
        #text(size: 7.2pt, fill: muted)[Igénylési szám: #issue-number]
      ]
    ]
  },
  footer: context [
    #align(left)[
      #text(size: 7.2pt, fill: muted)[#report-id · Generálva: #report-generated-at]
    ]
  ],
)

#set document(title: "Szervíz munkalap")
#set text(
  lang: "hu",
  font: ("Carlito", "DejaVu Sans"),
  size: 9pt,
)

#let info-card(label, value) = box(
  width: 100%,
  fill: white,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 6pt,
  inset: (x: 3.2mm, y: 1.8mm),
)[
  #text(size: 6.8pt, weight: "semibold", fill: muted)[#label]
  #v(0.6mm)
  #text(size: 8.8pt, weight: "bold", fill: ink)[#value]
]

#let stat(label, value) = box(
  width: 100%,
  fill: panel,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 6pt,
  inset: (x: 2.6mm, y: 1.7mm),
)[
  #text(size: 6.7pt, weight: "semibold", fill: muted)[#label]
  #v(0.4mm)
  #text(size: 8.8pt, weight: "bold", fill: brand-dark)[#value]
]

#let resolve-photo-path(raw-path) = if raw-path == none or raw-path == "" {
  none
} else if sys.inputs.at(raw-path, default: none) == none {
  raw-path
} else {
  sys.inputs.at(raw-path)
}

#let photo-path(photo) = fallback(
  resolve-photo-path(photo.at("path", default: photo.at("image_path", default: photo.at("url", default: none)))),
  none,
)

#let photo-caption(photo) = fallback(
  photo.at("caption", default: photo.at("title", default: photo.at("description", default: photo.at("note", default: none)))),
  "",
)

#let photo-card(photo) = box(
  width: 100%,
  fill: white,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 6pt,
  inset: (x: 2.6mm, y: 2.2mm),
)[
  #let path = photo-path(photo)
  #if path == none or path == "" [
    #box(
      width: 100%,
      height: 42mm,
      fill: panel,
      radius: 4pt,
    )[
      #align(center)[#text(size: 8pt, fill: muted)[Nincs kép]]
    ]
  ] else [
    #image(path, width: 100%)
  ]
  #let caption = photo-caption(photo)
  #if caption != "" [
    #v(1.2mm)
    #text(size: 7pt, weight: "semibold", fill: ink)[#caption]
  ]
]

#box(
  width: 100%,
  fill: brand,
  radius: 10pt,
  inset: (x: 5.6mm, y: 3.7mm),
)[
  #grid(
    columns: (20mm, 1fr),
    gutter: 5mm,
    [
      #box(
        width: 100%,
        fill: white,
        radius: 6pt,
        inset: 2mm,
      )[
        #align(center)[
          #image(logo-path, width: 15mm)
        ]
      ]
    ],
    [
      #text(size: 7.4pt, fill: accent, weight: "bold")[NoMa Klíma- és Hűtéstechnikai Kft.]
      #v(0.6mm)
      #text(size: 18pt, fill: white, weight: "bold")[Szervíz munkalap]
    ],
  )
]

#v(1.8mm)

#text(size: 8.8pt, weight: "bold", fill: brand-dark)[Áttekintés]
#v(1.1mm)

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 2.2mm,
  [#stat([Szervíz dátuma], service-date)],
  [#stat([Berendezés kód], device-code)],
  [#stat([Igénylési szám], issue-number)],
)

#v(1.8mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 2.2mm,
  [#info-card([Épület címe], building-address)],
  [#info-card([Épületkód], building-code)],
  [#info-card([Helyiség], room)],
  [#info-card([Berendezés típusa], device-type)],
  [#info-card([Márka, modell], brand-model)],
  [#info-card([Szervízt végző személy], maintainer)],
)

#v(2mm)

#box(
  width: 100%,
  fill: panel,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 7pt,
  inset: (x: 3.2mm, y: 2mm),
)[
  #text(size: 6.9pt, weight: "semibold", fill: muted)[Megjegyzés]
  #v(0.6mm)
  #if note == none or note == "" [
    #text(size: 7.6pt, fill: muted)[Nincs megjegyzés.]
  ] else [
    #text(size: 8pt, fill: ink)[#note]
  ]
]

#v(2mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 4mm,
  [],
  [
    #box(
      width: 100%,
      fill: panel,
      stroke: (paint: border, thickness: 0.7pt),
      radius: 7pt,
      inset: (x: 4mm, y: 3mm),
    )[
      #text(size: 7.5pt, weight: "semibold", fill: muted)[Referens személy neve, aláírása]
      #v(1mm)
      #if referent-signature-path == none or referent-signature-path == "" [
        #v(11mm)
      ] else [
        #align(center)[#image(referent-signature-path, width: 43mm)]
        #v(-1mm)
      ]
      #text(size: 8.2pt, weight: "bold", fill: ink)[#referent-name]
      #v(0.4mm)
      #if referent-role != "-" [
        #text(size: 7.2pt, fill: muted)[#referent-role]
      ]
    ]
  ],
)

#pagebreak()

#text(size: 8.8pt, weight: "bold", fill: brand-dark)[Csatolt képek]
#v(1.1mm)

#if photos.len() > 0 [
  #grid(
    columns: (1fr, 1fr),
    gutter: 3mm,
    ..photos.map(photo => [#photo-card(photo)]),
  )
] else [
  #box(
    width: 100%,
    fill: panel,
    stroke: (paint: border, thickness: 0.7pt),
    radius: 7pt,
    inset: (x: 3.2mm, y: 2.2mm),
  )[
    #text(size: 7.6pt, fill: muted)[Nincsenek csatolt képek.]
  ]
]
