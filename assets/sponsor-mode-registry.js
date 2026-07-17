(() => {
  "use strict";

  const select = (key, label, options, defaultValue, extra = {}) => ({
    key,
    label,
    type: "select",
    options: options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
    default: defaultValue,
    ...extra
  });

  const range = (key, label, min, max, step, defaultValue, unit = "", extra = {}) => ({
    key,
    label,
    type: "range",
    min,
    max,
    step,
    default: defaultValue,
    unit,
    ...extra
  });

  const toggle = (key, label, defaultValue, extra = {}) => ({
    key,
    label,
    type: "toggle",
    default: defaultValue,
    ...extra
  });

  const text = (key, label, defaultValue, extra = {}) => ({
    key,
    label,
    type: "text",
    default: defaultValue,
    ...extra
  });

  const commonControls = [
    range("size", "ขนาดรูป", 50, 800, 1, 180, "px", { group: "common" }),
    range("radius", "มุมโค้ง", 0, 50, 1, 0, "px", { group: "common" }),
    range("shadow", "เงา", 0, 1, 0.1, 0.55, "", { group: "common" })
  ];

  const positionOptions = [
    ["top", "ด้านบน"],
    ["center", "กึ่งกลาง"],
    ["bottom", "ด้านล่าง"],
    ["left", "ด้านซ้าย"],
    ["right", "ด้านขวา"]
  ];

  const horizontalOptions = [
    ["left", "ซ้าย"],
    ["center", "กลาง"],
    ["right", "ขวา"]
  ];

  const verticalOptions = [
    ["top", "บน"],
    ["center", "กลาง"],
    ["bottom", "ล่าง"]
  ];

  const positionControls = (defaultY = "bottom") => [
    select("posX", "ตำแหน่งแนวนอน", horizontalOptions, "center"),
    select("posY", "ตำแหน่งแนวตั้ง", verticalOptions, defaultY)
  ];

  const directionOptions = [
    ["right", "หมุนไปทางขวา"],
    ["left", "หมุนไปทางซ้าย"]
  ];

  const effectOptions = [
    ["fade", "เฟดเข้าออก"],
    ["slide", "เลื่อนขึ้น"],
    ["zoom", "ซูมเข้า"],
    ["flip", "พลิก 3D"],
    ["drop", "เด้งลง"],
    ["spin-in", "หมุนเข้า"],
    ["blur", "เบลอแล้วชัด"]
  ];

  const upstreamDefinitions = [
    {
      id: "grid",
      label: "แบบตาราง เรียงด้านล่าง",
      shortLabel: "Grid",
      category: "classic",
      description: "เรียงโลโก้ทุกแบรนด์เป็นแถวตารางบริเวณด้านล่างของจอ",
      defaults: { gap: 24, posX: "center", posY: "bottom", gridSpeed: 1000 },
      controls: [
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom"),
        range("gridSpeed", "ความเร็วเอฟเฟกต์เข้า", 100, 5000, 100, 1000, " ms")
      ]
    },
    {
      id: "rotator",
      label: "แบบหมุนวน ทีละภาพ",
      shortLabel: "Rotator",
      category: "classic",
      description: "แสดงโลโก้ทีละภาพและสลับอัตโนมัติด้วยเอฟเฟกต์ที่เลือก",
      defaults: {
        rotatorX: "center",
        rotatorY: "bottom",
        margin: 34,
        stayTime: 2.5,
        effect: "fade"
      },
      controls: [
        select("rotatorX", "ตำแหน่งแนวนอน", horizontalOptions, "center"),
        select("rotatorY", "ตำแหน่งแนวตั้ง", verticalOptions, "bottom"),
        range("margin", "ระยะจากขอบ", 0, 220, 1, 34, "px"),
        range("stayTime", "เวลาค้างต่อภาพ", 0.5, 10, 0.5, 2.5, " วินาที"),
        select("effect", "เอฟเฟกต์เปลี่ยนภาพ", effectOptions, "fade")
      ]
    },
    {
      id: "ticker",
      label: "แบบตัววิ่ง เลื่อนซ้าย",
      shortLabel: "Ticker",
      category: "motion",
      description: "เลื่อนโลโก้ต่อเนื่องจากขวาไปซ้ายแบบวนลูป",
      defaults: { tickerSpeed: 42, gap: 24, tickerY: 900, tickerX: "center" },
      controls: [
        range("tickerSpeed", "ความเร็ว", 5, 200, 1, 42),
        range("gap", "ระยะห่าง", 0, 200, 1, 24, "px"),
        range("tickerY", "ตำแหน่งแนวตั้ง", 0, 1000, 1, 900, "px"),
        select("tickerX", "พื้นที่แนวนอน", horizontalOptions, "center")
      ]
    },
    {
      id: "bounce",
      label: "แบบเด้ง DVD Saver",
      shortLabel: "Bounce",
      category: "playful",
      description: "โลโก้เคลื่อนที่และสะท้อนขอบจอในสไตล์ DVD screensaver",
      defaults: { bounceSpeed: 5, posX: "center", posY: "center" },
      controls: [
        range("bounceSpeed", "ความเร็ว", 1, 20, 1, 5),
        ...positionControls("center")
      ]
    },
    {
      id: "rain",
      label: "แบบฝนตก หล่นจากฟ้า",
      shortLabel: "Logo Rain",
      category: "playful",
      description: "โปรยโลโก้จากด้านบนลงด้านล่างแบบต่อเนื่อง",
      defaults: { rainSpeed: 5, rainDensity: 5, posX: "center", posY: "top" },
      controls: [
        range("rainSpeed", "ความเร็วตอนตก", 1, 20, 1, 5),
        range("rainDensity", "ความหนาแน่น", 1, 12, 1, 5),
        ...positionControls("top")
      ]
    },
    {
      id: "cover3d",
      label: "แบบ 3D Cover Flow",
      shortLabel: "3D Cover Flow",
      category: "showcase",
      description: "จัดโลโก้เป็นคารูเซลสามมิติพร้อมมิติความลึก",
      defaults: {
        coverSpeed: 1600,
        coverOpacity: 0.35,
        coverDir: "right",
        posX: "center",
        posY: "bottom"
      },
      controls: [
        range("coverSpeed", "ความเร็วหมุน", 500, 5000, 100, 1600, " ms"),
        range("coverOpacity", "ความชัดของโลโก้ด้านหลัง", 0.05, 1, 0.05, 0.35, "%", {
          format: "percent"
        }),
        select("coverDir", "ทิศทางหมุน", directionOptions, "right"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "pulse",
      label: "แบบชีพจร กระเพื่อม",
      shortLabel: "Pulse",
      category: "motion",
      description: "ขยายและย่อโลโก้เป็นจังหวะคล้ายชีพจร",
      defaults: { pulseSpeed: 900, gap: 24, posX: "center", posY: "bottom" },
      controls: [
        range("pulseSpeed", "ความเร็วกระเพื่อม", 200, 3000, 100, 900, " ms"),
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "spin",
      label: "แบบหมุนรอบ",
      shortLabel: "Spin",
      category: "motion",
      description: "หมุนโลโก้แต่ละภาพรอบตัวเองอย่างต่อเนื่อง",
      defaults: { spinSpeed: 2200, gap: 24, posX: "center", posY: "bottom" },
      controls: [
        range("spinSpeed", "ความเร็วหมุน", 500, 5000, 100, 2200, " ms"),
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "wiggle",
      label: "แบบสั่น ดุ๊กดิ๊ก",
      shortLabel: "Wiggle",
      category: "playful",
      description: "โยกโลโก้ซ้ายขวาเป็นจังหวะสนุกและเป็นกันเอง",
      defaults: { wiggleSpeed: 700, gap: 24, posX: "center", posY: "bottom" },
      controls: [
        range("wiggleSpeed", "ความเร็วสั่น", 100, 2000, 100, 700, " ms"),
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "float",
      label: "แบบลอยตัว",
      shortLabel: "Float",
      category: "motion",
      description: "ทำให้โลโก้ลอยขึ้นลงอย่างนุ่มนวล",
      defaults: { floatSpeed: 2000, gap: 24, posX: "center", posY: "bottom" },
      controls: [
        range("floatSpeed", "ความเร็วลอย", 500, 4000, 100, 2000, " ms"),
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "swing",
      label: "แบบแกว่งลูกตุ้ม",
      shortLabel: "Swing",
      category: "motion",
      description: "แกว่งโลโก้จากจุดยึดด้านบนคล้ายลูกตุ้ม",
      defaults: { swingSpeed: 1800, gap: 24, posX: "center", posY: "bottom" },
      controls: [
        range("swingSpeed", "ความเร็วแกว่ง", 500, 4000, 100, 1800, " ms"),
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "wave",
      label: "แบบคลื่นโลโก้",
      shortLabel: "Wave",
      category: "motion",
      description: "ยกโลโก้ขึ้นลงไล่ลำดับต่อกันเป็นคลื่น",
      defaults: {
        waveSpeed: 1800,
        waveHeight: 28,
        gap: 24,
        posX: "center",
        posY: "bottom"
      },
      controls: [
        range("waveSpeed", "ความเร็วคลื่น", 500, 5000, 100, 1800, " ms"),
        range("waveHeight", "ความสูงของคลื่น", 4, 90, 1, 28, "px"),
        range("gap", "ระยะห่าง", 0, 140, 1, 24, "px"),
        ...positionControls("bottom")
      ]
    },
    {
      id: "orbit",
      label: "แบบโคจรรอบกลาง",
      shortLabel: "Orbit",
      category: "showcase",
      description: "จัดโลโก้รอบวงและหมุนโคจรรอบจุดกึ่งกลาง",
      defaults: {
        orbitSpeed: 7000,
        orbitRadius: 220,
        orbitDir: "right",
        posX: "center",
        posY: "center"
      },
      controls: [
        range("orbitSpeed", "ความเร็วโคจร", 1200, 16000, 100, 7000, " ms"),
        range("orbitRadius", "รัศมีวงโคจร", 80, 520, 1, 220, "px"),
        select("orbitDir", "ทิศทางหมุน", directionOptions, "right"),
        ...positionControls("center")
      ]
    },
    {
      id: "spotlight",
      label: "แบบสปอตไลท์ทีละโลโก้",
      shortLabel: "Spotlight",
      category: "showcase",
      description: "ขยายโลโก้หลักกลางจอและแสดงลำดับแบรนด์ด้านล่าง",
      defaults: {
        spotlightSpeed: 2500,
        spotlightDim: 0.25,
        posX: "center",
        posY: "center"
      },
      controls: [
        range("spotlightSpeed", "เวลาสลับโลโก้", 700, 8000, 100, 2500, " ms"),
        range("spotlightDim", "ความจางของโลโก้ที่ไม่ได้เลือก", 0.05, 1, 0.05, 0.25, "%", {
          format: "percent"
        }),
        ...positionControls("center")
      ]
    }
  ];

  const redesignedCommon = [
    range("logoSize", "ขนาดโลโก้", 40, 220, 1, 112, "px", { group: "broadcast" }),
    range("gap", "ระยะห่าง", 4, 64, 1, 22, "px", { group: "broadcast" }),
    range("radius", "มุมโค้ง", 0, 60, 1, 22, "px", { group: "broadcast" }),
    range("opacity", "ความทึบของแผง", 0, 100, 1, 72, "%", { group: "broadcast" }),
    select(
      "shadow",
      "รูปแบบเงา",
      [
        ["none", "ไม่มีเงา"],
        ["soft", "เงานุ่ม"],
        ["strong", "เงาเข้ม"],
        ["neon", "แสงนีออน"]
      ],
      "soft",
      { group: "broadcast" }
    ),
    toggle("showNames", "แสดงชื่อ Sponsor", true, { group: "broadcast" }),
    toggle("showTier", "แสดงระดับ Sponsor", true, { group: "broadcast" })
  ];

  const redesignedDefinitions = [
    {
      id: "lower_third",
      label: "Bottom Sponsor Bar",
      shortLabel: "Lower Third",
      category: "broadcast",
      description: "แถบ Sponsor ด้านล่างสำหรับใช้ระหว่างการแข่งขันหรือรายการสด",
      defaults: {
        logoSize: 112,
        gap: 22,
        radius: 22,
        opacity: 72,
        shadow: "soft",
        showNames: true,
        showTier: true,
        position: "bottom",
        maxVisible: 6
      },
      commonControls: redesignedCommon,
      controls: [
        select(
          "position",
          "ตำแหน่ง",
          [["bottom", "ด้านล่าง"], ["center", "กึ่งกลาง"], ["top", "ด้านบน"]],
          "bottom"
        ),
        range("maxVisible", "จำนวนที่แสดงพร้อมกัน", 1, 8, 1, 6, " โลโก้")
      ]
    },
    {
      id: "corner_badge",
      label: "Corner Badge",
      shortLabel: "Corner Badge",
      category: "broadcast",
      description: "ป้าย Sponsor ขนาดกะทัดรัดสำหรับวางในมุมภาพ",
      defaults: {
        logoSize: 112,
        gap: 22,
        radius: 22,
        opacity: 72,
        shadow: "soft",
        showNames: true,
        showTier: true,
        position: "right"
      },
      commonControls: redesignedCommon,
      controls: [
        select(
          "position",
          "ตำแหน่งมุม",
          [
            ["left", "มุมล่างซ้าย"],
            ["right", "มุมล่างขวา"],
            ["bottom", "มุมล่างขวา (ค่าเดิม)"],
            ["top", "มุมบนขวา (ค่าเดิม)"],
            ["center", "กึ่งกลาง"],
            ["top-left", "มุมบนซ้าย"],
            ["top-right", "มุมบนขวา"]
          ],
          "right"
        )
      ]
    },
    {
      id: "side_tower",
      label: "Side Tower",
      shortLabel: "Side Tower",
      category: "broadcast",
      description: "เรียง Sponsor เป็นแนวตั้งชิดขอบ เหมาะกับพื้นที่ภาพแนวนอน",
      defaults: {
        logoSize: 112,
        gap: 18,
        radius: 22,
        opacity: 72,
        shadow: "soft",
        showNames: true,
        showTier: true,
        position: "right",
        maxVisible: 5
      },
      commonControls: redesignedCommon,
      controls: [
        select(
          "position",
          "ตำแหน่ง",
          [
            ["left", "ด้านซ้าย"],
            ["right", "ด้านขวา"],
            ["top", "แนวนอนด้านบน"],
            ["bottom", "แนวนอนด้านล่าง"]
          ],
          "right"
        ),
        range("maxVisible", "จำนวนที่แสดงพร้อมกัน", 1, 7, 1, 5, " โลโก้")
      ]
    },
    {
      id: "broadcast_ticker",
      label: "Ticker Run",
      shortLabel: "Broadcast Ticker",
      category: "broadcast",
      description: "Ticker โลโก้และชื่อ Sponsor แบบ broadcast ที่วนต่อเนื่องไร้รอยต่อ",
      defaults: {
        logoSize: 88,
        gap: 22,
        radius: 18,
        opacity: 82,
        shadow: "soft",
        showNames: true,
        showTier: true,
        position: "bottom",
        speed: 18
      },
      commonControls: redesignedCommon,
      controls: [
        select("position", "ตำแหน่ง", [["bottom", "ด้านล่าง"], ["top", "ด้านบน"]], "bottom"),
        range("speed", "ระยะเวลาวิ่งครบหนึ่งรอบ", 4, 60, 1, 18, " วินาที")
      ]
    },
    {
      id: "grid_board",
      label: "Grid Board",
      shortLabel: "Grid Board",
      category: "event",
      description: "บอร์ดรวม Sponsor แบบเต็มพื้นที่สำหรับช่วงพักหรือก่อนเริ่มรายการ",
      defaults: {
        logoSize: 132,
        gap: 22,
        radius: 22,
        opacity: 86,
        shadow: "soft",
        showNames: true,
        showTier: true,
        position: "center",
        maxVisible: 8,
        boardTitle: "OUR PARTNERS"
      },
      commonControls: redesignedCommon,
      controls: [
        range("maxVisible", "จำนวนที่แสดงพร้อมกัน", 2, 12, 1, 8, " โลโก้"),
        text("boardTitle", "หัวข้อบนบอร์ด", "OUR PARTNERS")
      ]
    },
    {
      id: "sponsor_break",
      label: "Fullscreen Sponsor Break",
      shortLabel: "Sponsor Break",
      category: "event",
      description: "ฉาก Sponsor เต็มจอสำหรับพักครึ่ง พักรายการ หรือช่วงเปลี่ยนฉาก",
      defaults: {
        logoSize: 156,
        gap: 26,
        radius: 24,
        opacity: 92,
        shadow: "strong",
        showNames: true,
        showTier: false,
        position: "center",
        maxVisible: 8,
        breakKicker: "PEPSLIVE PARTNERS",
        breakTitle: "Presented By"
      },
      commonControls: redesignedCommon,
      controls: [
        range("maxVisible", "จำนวนที่แสดงพร้อมกัน", 2, 12, 1, 8, " โลโก้"),
        text("breakKicker", "ข้อความด้านบน", "PEPSLIVE PARTNERS"),
        text("breakTitle", "หัวข้อหลัก", "Presented By")
      ]
    },
    {
      id: "goal_popup",
      label: "Goal Sponsor Popup",
      shortLabel: "Goal Popup",
      category: "event",
      description: "การ์ด Sponsor แบบเร้าใจสำหรับ Trigger เมื่อทำประตูหรือเกิดไฮไลต์",
      defaults: {
        logoSize: 150,
        gap: 22,
        radius: 24,
        opacity: 94,
        shadow: "neon",
        showNames: true,
        showTier: false,
        position: "center",
        goalLabel: "GOAL",
        goalPrefix: "Presented by"
      },
      commonControls: redesignedCommon,
      controls: [
        select("position", "ตำแหน่ง", positionOptions, "center"),
        text("goalLabel", "ข้อความหลัก", "GOAL"),
        text("goalPrefix", "ข้อความก่อนชื่อ Sponsor", "Presented by")
      ]
    }
  ];

  const definitions = [...upstreamDefinitions, ...redesignedDefinitions].map((definition) => {
    const inherited = definition.commonControls || commonControls;
    return Object.freeze({
      ...definition,
      commonControls: Object.freeze(inherited.map((control) => Object.freeze({ ...control }))),
      controls: Object.freeze(definition.controls.map((control) => Object.freeze({ ...control }))),
      defaults: Object.freeze({ ...definition.defaults })
    });
  });

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const ids = Object.freeze(definitions.map((definition) => definition.id));
  const labels = Object.freeze(
    definitions.reduce((output, definition) => {
      output[definition.id] = definition.label;
      return output;
    }, {})
  );

  const legacyMap = Object.freeze({
    bottom_bar: "lower_third",
    ticker: "broadcast_ticker",
    grid: "grid_board",
    fullscreen_break: "sponsor_break"
  });

  function get(id) {
    return byId.get(String(id || "")) || null;
  }

  function has(id) {
    return byId.has(String(id || ""));
  }

  function defaultsFor(id) {
    const definition = get(id);
    if (!definition) return {};
    const defaults = {};
    definition.commonControls.forEach((control) => {
      defaults[control.key] = control.default;
    });
    return { ...defaults, ...definition.defaults };
  }

  function controlsFor(id) {
    const definition = get(id);
    if (!definition) return [];
    const merged = new Map();
    [...definition.commonControls, ...definition.controls].forEach((control) => {
      merged.set(control.key, control);
    });
    return Array.from(merged.values()).map((control) => ({ ...control }));
  }

  function mapRedesignMode(id) {
    const value = String(id || "");
    return legacyMap[value] || value;
  }

  window.PepsSponsorModes = Object.freeze({
    definitions: Object.freeze(definitions),
    ids,
    labels,
    get,
    has,
    defaultsFor,
    controlsFor,
    mapRedesignMode
  });
})();
