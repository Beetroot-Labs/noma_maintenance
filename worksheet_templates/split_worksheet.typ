#let brand = rgb("#004c47")
#let brand-dark = rgb("#003a36")
#let accent = rgb("#c9ac67")
#let ink = rgb("#1a2b2a")
#let muted = rgb("#5f7472")
#let border = rgb("#c9d8d6")
#let panel = rgb("#f4f8f7")
#let row-alt = rgb("#f9fbfb")

#let report-id = [MW-2026-04-13-0042]
#let report-generated-at = [2026.04.21. 16:24]

#let building-address = [Budapest, Fő u. 44-50.]
#let building-code = [H011.FMG.K0013.A.00023]
#let room-path = [B épület / 3. emelet / 366 / Iroda]
#let device-type = [Komfort Split]
#let device-brand = [Daikin]
#let device-model = [FTXM50A]
#let device-brand-model = [#device-brand / #device-model]
#let source-device-code = [09A000000102003]
#let maintenance-date = [2026.04.13.]
#let reference-number = [Q357451]
#let maintainer = [Surányi András]

#let checklist = (
  (
    task: "Kül- és beltéri egységek állapotvizsgálata",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Általános külső és belső tisztítás",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Hűtőközeg ellenőrzése, esetleges utántöltése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Üzemi nyomások ellenőrzése, beállítása",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Feszültségek, áramfelvételek mérése",
    status: "Elvégezve",
    note: "Mért értékek: L1-L2-L3 = 398/401/399 V; kompresszor áramfelvétel = 6.8 A; beltéri ventilátor = 0.42 A.",
  ),
  (
    task: "Szűrőelemek tisztítása, esetleges cseréje",
    status: "Javítva",
    note: "Szűrőkeret rögzítése után ismét megfelelő.",
  ),
  (
    task: "Cseppvíz elvezetés ellenőrzése, dugulás elhárítása",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Cseppvíz tálcák fetőtlenítése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Kültéri egység hőcserélőjének ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Beltéri egység vegyszeres tisztítása, fertőtlenítése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Szabályzó automatika ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Távirányítók ellenőrzése, elemek cseréje",
    status: "Cserélve",
    note: "Elemcsere történt mindkét távirányítón.",
  ),
  (
    task: "Elzáró szerkezetek mechanikus ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Szabályozó szerkezetek mechanikus ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Levegő elzáró-nyitó szerkezetek ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Üzemi hőmérsékletek ellenőrzése",
    status: "Elvégezve",
    note: "Befújt levegő: 12.4 °C.",
  ),
  (
    task: "Berendezés/rendszer tömítettségének vizsgálata",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Elektromos csatlakozások ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Ablakklímák huzatmentesítése, szigetelések ellenőrzése",
    status: "Nincs elvégezve",
    note: "Nem releváns: a berendezés nem ablakklíma.",
  ),
  (
    task: "Zajszint ellenőrzése",
    status: "Elvégezve",
    note: "Mért zajszint: beltéri 1 m-en 38 dB(A), kültéri 1 m-en 52 dB(A), rendellenes zaj nem tapasztalható.",
  ),
  (
    task: "Rögzítések, tartószerkezetek ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
  (
    task: "Rezgécsillapítók ellenőrzése",
    status: "Elvégezve",
    note: none,
  ),
)

#let detected-faults = (
  "Szurokeret rogzitese meglazult a belteri egysegben, helyszinen javitva.",
)

#let extra-note = [A cseppvíz elvezetés tisztítása után a kondenzvíz elfolyása megfelelő, utóellenőrzés 30 napon belül javasolt.]

#set page(
  paper: "a4",
  margin: (x: 7mm, y: 7mm),
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

#set document(title: "Részletes munkalap")
#set text(
  lang: "hu",
  font: ("Carlito", "DejaVu Sans"),
  size: 8.5pt,
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

#let status-pill(value) = if value == "Elvégezve" {
  box(
    fill: rgb("#e6f6ec"),
    radius: 999pt,
    inset: (x: 1.9mm, y: 0.65mm),
  )[
    #text(size: 6.4pt, weight: "bold", fill: rgb("#0f6f3b"))[#value]
  ]
} else if value == "Javítva" {
  box(
    fill: rgb("#fff3df"),
    radius: 999pt,
    inset: (x: 1.9mm, y: 0.65mm),
  )[
    #text(size: 6.4pt, weight: "bold", fill: rgb("#8a5a00"))[#value]
  ]
} else if value == "Cserélve" {
  box(
    fill: rgb("#e8efff"),
    radius: 999pt,
    inset: (x: 1.9mm, y: 0.65mm),
  )[
    #text(size: 6.4pt, weight: "bold", fill: rgb("#1b4d9d"))[#value]
  ]
} else {
  box(
    fill: rgb("#fde9e9"),
    radius: 999pt,
    inset: (x: 1.9mm, y: 0.65mm),
  )[
    #text(size: 6.4pt, weight: "bold", fill: rgb("#a22626"))[#value]
  ]
}

#let note-cell(value) = if value == none {
  [#text(size: 6.8pt, fill: muted)[—]]
} else if value == "" {
  [#text(size: 6.8pt, fill: muted)[—]]
} else {
  [#text(size: 6.8pt, fill: ink)[#value]]
}

#let checklist-cells = checklist.map(item => (
  [#text(size: 8pt, fill: ink)[#item.at("task")]],
  [#align(center)[#status-pill(item.at("status"))]],
  [#note-cell(item.at("note"))],
)).flatten()

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
          #image("../frontend/apps/main/public/Noma_logo_color_text_vertical.png", width: 15mm)
        ]
      ]
    ],
    [
      #text(size: 7.4pt, fill: accent, weight: "bold")[NoMa Klíma- és Hűtéstechnikai Kft.]
      #v(0.6mm)
      #text(size: 18pt, fill: white, weight: "bold")[Részletes karbantartási munkalap]
      #v(0.6mm)
      #text(size: 7.1pt, fill: rgb("#d8ebe8"))[Automatikusan generált egyedi munkalap]
    ],
  )
]

#v(1.8mm)

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 2.2mm,
  [#stat([Karbantartás dátuma], maintenance-date)],
  [#stat([Berendezés kód], source-device-code)],
  [#stat([Hivatkozási szám], reference-number)],
)

#v(1.8mm)

#grid(
  columns: (1fr, 1fr),
  gutter: 2.2mm,
  [#info-card([Épület címe], building-address)],
  [#info-card([Épületkód], building-code)],
  [#info-card([Helyiség], room-path)],
  [#info-card([Berendezés típusa], device-type)],
  [#info-card([Márka, modell], device-brand-model)],
  [#info-card([Karbantartást végző személy], maintainer)],
)

#v(1.8mm)

#set text(size: 7pt)
#table(
  columns: (1.55fr, 0.74fr, 1.25fr),
  align: (left, center, left),
  inset: (x: 1.8mm, y: 1.1mm),
  stroke: (paint: border, thickness: 0.7pt),
  fill: (x, y) => if y == 0 { brand-dark } else if calc.odd(y) { row-alt } else { white },
  table.header(
    [#text(size: 6.7pt, fill: white, weight: "bold")[Ellenőrzési tétel]],
    [#text(size: 6.7pt, fill: white, weight: "bold")[Állapot]],
    [#text(size: 6.7pt, fill: white, weight: "bold")[Megjegyzés]],
  ),
  ..checklist-cells,
)

#set text(size: 8.5pt)
#v(1.8mm)

#if detected-faults.len() > 0 [
  #box(
    width: 100%,
    fill: panel,
    stroke: (paint: border, thickness: 0.7pt),
    radius: 7pt,
    inset: (x: 3.2mm, y: 2mm),
  )[
    #text(size: 6.9pt, weight: "semibold", fill: muted)[Feltárt hibák]
    #v(0.6mm)
    #for fault in detected-faults [
      #text(size: 7.6pt, fill: ink)[- #fault]
      #linebreak()
    ]
  ]

  #v(1.8mm)
]

#box(
  width: 100%,
  fill: panel,
  stroke: (paint: border, thickness: 0.7pt),
  radius: 7pt,
  inset: (x: 3.2mm, y: 2mm),
)[
  #text(size: 6.9pt, weight: "semibold", fill: muted)[Egyéb megjegyzés]
  #v(0.6mm)
  #if extra-note == none [
    #text(size: 7.6pt, fill: muted)[Nincs egyéb megjegyzés.]
  ] else if extra-note == "" [
    #text(size: 7.6pt, fill: muted)[Nincs egyéb megjegyzés.]
  ] else [
    #text(size: 7.6pt, fill: ink)[#extra-note]
  ]
]
