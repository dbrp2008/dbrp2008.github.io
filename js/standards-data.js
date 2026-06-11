/* Embedded pipe standards data.
 * For a given NPS/DN the outer diameter (OD) is fixed; the schedule/series sets
 * wall thickness, which determines inner diameter and pressure rating.
 * Dimensions in mm. Sources: ASME B36.10M / B36.19M, EN 10220, JIS G3454 charts.
 */
(function () {
  'use strict';

  // ASME / ANSI imperial sizes. OD per B36.10M.
  var NPS_KEYS = ['1/2', '3/4', '1', '1 1/2', '2', '3', '4', '6', '8', '10', '12'];
  var NPS_OD   = [21.3, 26.7, 33.4, 48.3, 60.3, 88.9, 114.3, 168.3, 219.1, 273.1, 323.9];

  // Wall thickness per schedule, aligned with NPS_KEYS. null = size not defined in that schedule.
  var ASME_WALLS = {
    '10':  [2.11, 2.11, 2.77, 2.77, 2.77, 3.05, 3.05, 3.40, 3.76, 4.19, 4.57],
    '20':  [null, null, null, null, null, null, null, null, 6.35, 6.35, 6.35],
    '30':  [null, null, null, null, null, null, null, null, 7.04, 7.80, 8.38],
    'STD': [2.77, 2.87, 3.38, 3.68, 3.91, 5.49, 6.02, 7.11, 8.18, 9.27, 9.53],
    '40':  [2.77, 2.87, 3.38, 3.68, 3.91, 5.49, 6.02, 7.11, 8.18, 9.27, 10.31],
    '60':  [null, null, null, null, null, null, null, null, 10.31, 12.70, 14.27],
    'XS':  [3.73, 3.91, 4.55, 5.08, 5.54, 7.62, 8.56, 10.97, 12.70, 12.70, 12.70],
    '80':  [3.73, 3.91, 4.55, 5.08, 5.54, 7.62, 8.56, 10.97, 12.70, 15.09, 17.48],
    '120': [null, null, null, null, null, null, 11.13, 14.27, 18.26, 21.44, 25.40],
    '160': [4.78, 5.56, 6.35, 7.14, 8.74, 11.13, 13.49, 18.26, 23.01, 28.58, 33.32],
    'XXS': [7.47, 7.82, 9.09, 10.15, 11.07, 15.24, 17.12, 21.95, 22.23, 25.40, 25.40]
  };

  // Stainless (B36.19M) walls.
  var B3619_WALLS = {
    '5S':  [1.65, 1.65, 1.65, 1.65, 1.65, 2.11, 2.11, 2.77, 2.77, 3.40, 3.96],
    '10S': [2.11, 2.11, 2.77, 2.77, 2.77, 3.05, 3.05, 3.40, 3.76, 4.19, 4.57],
    '40S': [2.77, 2.87, 3.38, 3.68, 3.91, 5.49, 6.02, 7.11, 8.18, 9.27, 9.53],
    '80S': [3.73, 3.91, 4.55, 5.08, 5.54, 7.62, 8.56, 10.97, 12.70, 12.70, 12.70]
  };

  // EN 10220 / DIN metric. OD per EN 10220 preferred series.
  var DN_KEYS = ['DN15', 'DN20', 'DN25', 'DN40', 'DN50', 'DN80', 'DN100', 'DN150', 'DN200', 'DN250', 'DN300'];
  var DN_OD   = [21.3, 26.9, 33.7, 48.3, 60.3, 88.9, 114.3, 168.3, 219.1, 273.0, 323.9];
  var EN_WALLS = {
    'Light (Series 1)':  [2.0, 2.3, 2.6, 2.6, 2.9, 3.2, 3.6, 4.5, 5.9, 6.3, 7.1],
    'Medium (Series 2)': [2.6, 2.6, 3.2, 3.2, 3.6, 4.0, 4.5, 5.6, 6.3, 7.1, 8.0],
    'Heavy (Series 3)':  [3.2, 3.2, 4.0, 4.0, 4.5, 5.0, 5.6, 7.1, 8.0, 8.8, 10.0]
  };

  // JIS G3454 metric A-sizes (note slightly different ODs than ASME/EN).
  var JIS_KEYS = ['15A', '20A', '25A', '40A', '50A', '80A', '100A', '150A', '200A', '250A', '300A'];
  var JIS_OD   = [21.7, 27.2, 34.0, 48.6, 60.5, 89.1, 114.3, 165.2, 216.3, 267.4, 318.5];
  var JIS_WALLS = {
    'Sch 40': [2.8, 2.9, 3.4, 3.7, 3.9, 5.5, 6.0, 7.1, 8.2, 9.3, 10.3],
    'Sch 80': [3.7, 3.9, 4.5, 5.1, 5.5, 7.6, 8.6, 11.0, 12.7, 15.1, 17.4]
  };

  function buildSchedules(keys, ods, wallTable) {
    var schedules = {};
    Object.keys(wallTable).forEach(function (sch) {
      var sizes = {};
      wallTable[sch].forEach(function (wall, i) {
        if (wall !== null) sizes[keys[i]] = { od: ods[i], wall: wall };
      });
      schedules[sch] = sizes;
    });
    return schedules;
  }

  var STANDARDS = {
    families: {
      'ASME': {
        label: 'ASME B36.10M / B36.19M (USA)',
        note: 'B36.10M carbon/alloy steel schedules; 5S–80S are B36.19M stainless schedules.',
        units: 'in',
        sizeKeys: NPS_KEYS,
        schedules: (function () {
          var s = buildSchedules(NPS_KEYS, NPS_OD, ASME_WALLS);
          var ss = buildSchedules(NPS_KEYS, NPS_OD, B3619_WALLS);
          Object.keys(ss).forEach(function (k) { s[k] = ss[k]; });
          return s;
        })()
      },
      'ANSI': {
        label: 'ANSI B36.10 (USA, legacy name)',
        note: 'Identical to ASME B36.10M — ANSI standards were renamed to ASME in the 1980s.',
        units: 'in',
        sizeKeys: NPS_KEYS,
        schedules: buildSchedules(NPS_KEYS, NPS_OD, ASME_WALLS)
      },
      'EN': {
        label: 'EN 10220 (Europe)',
        note: 'European metric dimension series for seamless and welded steel tubes.',
        units: 'mm',
        sizeKeys: DN_KEYS,
        schedules: buildSchedules(DN_KEYS, DN_OD, EN_WALLS)
      },
      'DIN': {
        label: 'DIN 2448 (Germany, withdrawn)',
        note: 'Superseded by EN 10220; offered here with equivalent EN dimension series.',
        units: 'mm',
        sizeKeys: DN_KEYS,
        schedules: buildSchedules(DN_KEYS, DN_OD, EN_WALLS)
      },
      'JIS': {
        label: 'JIS G3454 (Japan)',
        note: 'Carbon steel pipes for pressure service (≤350°C). JIS G3452 SGP covers low-pressure lines.',
        units: 'mm',
        sizeKeys: JIS_KEYS,
        schedules: buildSchedules(JIS_KEYS, JIS_OD, JIS_WALLS)
      }
    },

    // Allowable stress S in MPa (already includes design margin), used in Barlow's formula.
    materials: {
      carbon:    { label: 'Carbon steel (A53/A106 Gr.B)', S: 118, color: '#8a8f98', color3d: 0x8a8f98 },
      stainless: { label: 'Stainless steel (A312 316L)',  S: 115, color: '#b8c4cf', color3d: 0xb8c4cf },
      pvc:       { label: 'PVC (Sch 40/80)',              S: 6.9, color: '#d9dde2', color3d: 0xe8e3d5 }
    },

    // ASME B16.5 class -> ambient rated pressure (bar), carbon steel group 1.1 approx.
    flangeClasses: { '150': 19.6, '300': 51.1, '600': 102.1, '900': 153.2 }
  };

  function familyData(family) { return STANDARDS.families[family]; }

  function scheduleNames(family) { return Object.keys(STANDARDS.families[family].schedules); }

  // Size keys available in the given family+schedule, in canonical order.
  function sizeKeys(family, schedule) {
    var fam = STANDARDS.families[family];
    var sizes = fam.schedules[schedule] || {};
    return fam.sizeKeys.filter(function (k) { return !!sizes[k]; });
  }

  // -> {od, wall, id} in mm, or null if size unavailable in schedule.
  function sizeData(family, schedule, sizeKey) {
    var fam = STANDARDS.families[family];
    if (!fam) return null;
    var sizes = fam.schedules[schedule];
    if (!sizes || !sizes[sizeKey]) return null;
    var d = sizes[sizeKey];
    return { od: d.od, wall: d.wall, id: +(d.od - 2 * d.wall).toFixed(2) };
  }

  // Barlow's formula P = 2*S*t/D, result in bar (S in MPa, t & D in mm; 1 MPa = 10 bar).
  function ratedPressureBar(odMm, wallMm, materialKey) {
    var mat = STANDARDS.materials[materialKey];
    if (!mat || !odMm) return 0;
    return +(2 * mat.S * wallMm / odMm * 10).toFixed(1);
  }

  function flangeRatingBar(cls) { return STANDARDS.flangeClasses[String(cls)] || 0; }

  // Approximate flange dimensions (mm) in the style of ASME B16.5: outer diameter,
  // bolt circle diameter (PCD), thickness, bolt hole count and bolt hole diameter.
  // Scaled from the pipe OD/ID at the given size, with a multiplier per pressure class —
  // representative for simulator purposes rather than a literal standard lookup.
  var FLANGE_CLASS_FACTOR = { '150': 1.0, '300': 1.15, '600': 1.3, '900': 1.45 };

  function flangeDims(family, schedule, sizeKey, cls) {
    var d = sizeData(family, schedule, sizeKey);
    if (!d) return null;
    var f = FLANGE_CLASS_FACTOR[String(cls)] || 1.0;
    var od = +(d.od + Math.max(40, d.od * 0.55) * f).toFixed(1);
    var pcd = +(od - Math.max(20, d.od * 0.22) * f).toFixed(1);
    var thickness = +((Math.max(12, d.od * 0.12 + 4)) * f).toFixed(1);
    var boltDia = +((Math.max(12, d.od * 0.045)) * f).toFixed(1);
    var boltCount = 4;
    if (d.od > 88.9) boltCount = 8;
    if (d.od > 219.1) boltCount = 12;
    return { od: od, id: d.id, pcd: pcd, thickness: thickness, boltCount: boltCount, boltDia: boltDia };
  }

  // Display a size label with units context (e.g. NPS 2" or DN50).
  function sizeLabel(family, sizeKey) {
    var fam = STANDARDS.families[family];
    return fam.units === 'in' ? 'NPS ' + sizeKey + '"' : sizeKey;
  }

  window.PipeStandards = {
    STANDARDS: STANDARDS,
    familyData: familyData,
    scheduleNames: scheduleNames,
    sizeKeys: sizeKeys,
    sizeData: sizeData,
    ratedPressureBar: ratedPressureBar,
    flangeRatingBar: flangeRatingBar,
    flangeDims: flangeDims,
    sizeLabel: sizeLabel
  };
})();
