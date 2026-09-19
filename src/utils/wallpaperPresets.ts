export interface WallpaperPreset {
  id: string;
  name: string;
  category: "gradients" | "vectors";
  url: string;
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  // -------------------------------------------------------------
  // 1. ОДНОТОННЫЕ & МЯГКИЕ ГЛУБОКИЕ ГРАДИЕНТЫ
  // -------------------------------------------------------------
  {
    id: "obsidian-abyss",
    name: "Обсидиановая бездна",
    category: "gradients",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="g1" cx="50%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#141824"/>
            <stop offset="60%" stop-color="#0b0e14"/>
            <stop offset="100%" stop-color="#06080b"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g1)"/>
      </svg>
    `),
  },
  {
    id: "lunar-amethyst",
    name: "Лунный аметист",
    category: "gradients",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="g2" cx="70%" cy="20%" r="65%">
            <stop offset="0%" stop-color="#311f58"/>
            <stop offset="45%" stop-color="#1a142e"/>
            <stop offset="100%" stop-color="#090b10"/>
          </radialGradient>
          <radialGradient id="g2b" cx="20%" cy="80%" r="55%">
            <stop offset="0%" stop-color="#191533" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#090b10" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g2)"/>
        <rect width="100%" height="100%" fill="url(#g2b)"/>
      </svg>
    `),
  },
  {
    id: "cozy-hearth",
    name: "Уютный камин",
    category: "gradients",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="g3" cx="50%" cy="95%" r="70%">
            <stop offset="0%" stop-color="#421f14"/>
            <stop offset="40%" stop-color="#211210"/>
            <stop offset="100%" stop-color="#090a0e"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g3)"/>
      </svg>
    `),
  },
  {
    id: "emerald-mist",
    name: "Изумрудная мгла",
    category: "gradients",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="g4" cx="30%" cy="40%" r="65%">
            <stop offset="0%" stop-color="#0f2b23"/>
            <stop offset="50%" stop-color="#0b1a16"/>
            <stop offset="100%" stop-color="#070b09"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g4)"/>
      </svg>
    `),
  },
  {
    id: "midnight-indigo",
    name: "Полуночный индиго",
    category: "gradients",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="g5" cx="80%" cy="85%" r="70%">
            <stop offset="0%" stop-color="#152642"/>
            <stop offset="50%" stop-color="#0d1729"/>
            <stop offset="100%" stop-color="#080c14"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g5)"/>
      </svg>
    `),
  },

  // -------------------------------------------------------------
  // 2. ВЕКТОРНЫЕ СЮЖЕТНЫЕ SVG-ПАТТЕРНЫ
  // -------------------------------------------------------------
  {
    id: "starfield-cosmos",
    name: "Звёздная ночь",
    category: "vectors",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="sky" cx="50%" cy="20%" r="80%">
            <stop offset="0%" stop-color="#171b30"/>
            <stop offset="60%" stop-color="#0d101d"/>
            <stop offset="100%" stop-color="#07080d"/>
          </radialGradient>
          <radialGradient id="nebula" cx="65%" cy="35%" r="40%">
            <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#sky)"/>
        <rect width="100%" height="100%" fill="url(#nebula)"/>
        <!-- Созвездия и звёзды -->
        <g fill="#ffffff">
          <circle cx="150" cy="180" r="1.5" opacity="0.6"/>
          <circle cx="280" cy="90" r="2.2" opacity="0.85"/>
          <circle cx="420" cy="220" r="1.2" opacity="0.5"/>
          <circle cx="610" cy="110" r="2.5" opacity="0.9"/>
          <circle cx="780" cy="310" r="1.8" opacity="0.7"/>
          <circle cx="950" cy="140" r="1.2" opacity="0.4"/>
          <circle cx="1120" cy="260" r="2.2" opacity="0.8"/>
          <circle cx="1340" cy="130" r="1.5" opacity="0.6"/>
          <circle cx="1510" cy="340" r="2.5" opacity="0.9"/>
          <circle cx="1720" cy="180" r="1.8" opacity="0.7"/>
          <circle cx="1830" cy="90" r="1.2" opacity="0.5"/>
          <circle cx="220" cy="480" r="1.5" opacity="0.5"/>
          <circle cx="510" cy="560" r="2" opacity="0.75"/>
          <circle cx="890" cy="620" r="1.2" opacity="0.4"/>
          <circle cx="1250" cy="490" r="2.2" opacity="0.85"/>
          <circle cx="1640" cy="580" r="1.5" opacity="0.6"/>
          <circle cx="340" cy="820" r="2.5" opacity="0.8"/>
          <circle cx="740" cy="890" r="1.5" opacity="0.5"/>
          <circle cx="1180" cy="810" r="1.8" opacity="0.65"/>
          <circle cx="1550" cy="890" r="2.2" opacity="0.85"/>
        </g>
        <!-- Тонкие линии созвездия -->
        <g stroke="#ffffff" stroke-width="0.75" stroke-opacity="0.22" stroke-dasharray="3 3">
          <line x1="280" y1="90" x2="420" y2="220"/>
          <line x1="420" y1="220" x2="610" y2="110"/>
          <line x1="1120" y1="260" x2="1340" y2="130"/>
          <line x1="1340" y1="130" x2="1510" y2="340"/>
        </g>
      </svg>
    `),
  },
  {
    id: "night-rain",
    name: "Ночной дождь",
    category: "vectors",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="rainSky" x1="0" y1="0" x2="0" y2="100%">
            <stop offset="0%" stop-color="#080c14"/>
            <stop offset="70%" stop-color="#0f1624"/>
            <stop offset="100%" stop-color="#161f33"/>
          </linearGradient>
          <radialGradient id="cityGlow" cx="50%" cy="100%" r="50%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#rainSky)"/>
        <rect width="100%" height="100%" fill="url(#cityGlow)"/>
        <!-- Полосы дождя -->
        <g stroke="#7dd3fc" stroke-width="1.2" stroke-opacity="0.18" stroke-linecap="round">
          <line x1="100" y1="50" x2="70" y2="180"/>
          <line x1="260" y1="120" x2="230" y2="250"/>
          <line x1="420" y1="40" x2="390" y2="170"/>
          <line x1="580" y1="200" x2="550" y2="330"/>
          <line x1="740" y1="80" x2="710" y2="210"/>
          <line x1="900" y1="150" x2="870" y2="280"/>
          <line x1="1060" y1="60" x2="1030" y2="190"/>
          <line x1="1220" y1="190" x2="1190" y2="320"/>
          <line x1="1380" y1="70" x2="1350" y2="200"/>
          <line x1="1540" y1="140" x2="1510" y2="270"/>
          <line x1="1700" y1="80" x2="1670" y2="210"/>
          <line x1="1860" y1="170" x2="1830" y2="300"/>
          <line x1="160" y1="450" x2="130" y2="580"/>
          <line x1="380" y1="520" x2="350" y2="650"/>
          <line x1="680" y1="480" x2="650" y2="610"/>
          <line x1="980" y1="550" x2="950" y2="680"/>
          <line x1="1280" y1="470" x2="1250" y2="600"/>
          <line x1="1580" y1="530" x2="1550" y2="660"/>
          <line x1="1800" y1="460" x2="1770" y2="590"/>
          <line x1="220" y1="800" x2="190" y2="930"/>
          <line x1="540" y1="780" x2="510" y2="910"/>
          <line x1="860" y1="830" x2="830" y2="960"/>
          <line x1="1160" y1="790" x2="1130" y2="920"/>
          <line x1="1480" y1="820" x2="1450" y2="950"/>
          <line x1="1740" y1="770" x2="1710" y2="900"/>
        </g>
      </svg>
    `),
  },
  {
    id: "dark-academia",
    name: "Тайная библиотека",
    category: "vectors",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="acadBg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#14111a"/>
            <stop offset="60%" stop-color="#0c0a10"/>
            <stop offset="100%" stop-color="#070609"/>
          </linearGradient>
          <radialGradient id="candleGlow" cx="50%" cy="60%" r="45%">
            <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#f59e0b" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#acadBg)"/>
        <rect width="100%" height="100%" fill="url(#candleGlow)"/>
        <!-- Готическая стрельчатая арка по центру -->
        <path d="M760 1080 V500 C760 320 960 180 960 180 C960 180 1160 320 1160 500 V1080" 
              fill="none" stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.15"/>
        <path d="M800 1080 V520 C800 370 960 240 960 240 C960 240 1120 370 1120 520 V1080" 
              fill="none" stroke="#ffffff" stroke-width="0.8" stroke-opacity="0.08"/>
        <!-- Полки и книги по краям -->
        <g stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.2">
          <!-- Левые полки -->
          <line x1="80" y1="350" x2="520" y2="350"/>
          <line x1="80" y1="600" x2="520" y2="600"/>
          <line x1="80" y1="850" x2="520" y2="850"/>
          <!-- Правые полки -->
          <line x1="1400" y1="350" x2="1840" y2="350"/>
          <line x1="1400" y1="600" x2="1840" y2="600"/>
          <line x1="1400" y1="850" x2="1840" y2="850"/>
        </g>
        <!-- Силуэты стоящих книг -->
        <g fill="#ffffff" fill-opacity="0.06">
          <rect x="120" y="270" width="24" height="80" rx="3"/>
          <rect x="150" y="250" width="32" height="100" rx="3"/>
          <rect x="190" y="280" width="20" height="70" rx="3"/>
          <rect x="220" y="260" width="28" height="90" rx="3"/>
          <rect x="1440" y="260" width="28" height="90" rx="3"/>
          <rect x="1480" y="240" width="36" height="110" rx="3"/>
          <rect x="1525" y="270" width="22" height="80" rx="3"/>
        </g>
      </svg>
    `),
  },
  {
    id: "cyber-horizon",
    name: "Кибер-горизонт",
    category: "vectors",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="cyberSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0a0c16"/>
            <stop offset="55%" stop-color="#141126"/>
            <stop offset="100%" stop-color="#07080e"/>
          </linearGradient>
          <linearGradient id="horizonGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#cyberSky)"/>
        <!-- Свечение горизонта -->
        <ellipse cx="960" cy="580" rx="700" ry="120" fill="url(#horizonGlow)"/>
        <line x1="0" y1="580" x2="1920" y2="580" stroke="#8b5cf6" stroke-width="1.2" stroke-opacity="0.4"/>
        <!-- 3D-сетка, уходящая в перспективу -->
        <g stroke="#8b5cf6" stroke-opacity="0.14" stroke-width="1">
          <!-- Сходящиеся лучи из точки горизонта -->
          <line x1="960" y1="580" x2="-200" y2="1080"/>
          <line x1="960" y1="580" x2="150" y2="1080"/>
          <line x1="960" y1="580" x2="480" y2="1080"/>
          <line x1="960" y1="580" x2="740" y2="1080"/>
          <line x1="960" y1="580" x2="960" y2="1080"/>
          <line x1="960" y1="580" x2="1180" y2="1080"/>
          <line x1="960" y1="580" x2="1440" y2="1080"/>
          <line x1="960" y1="580" x2="1770" y2="1080"/>
          <line x1="960" y1="580" x2="2120" y2="1080"/>
          <!-- Горизонтальные поперечные линии с логарифмическим шагом -->
          <line x1="0" y1="600" x2="1920" y2="600"/>
          <line x1="0" y1="630" x2="1920" y2="630"/>
          <line x1="0" y1="675" x2="1920" y2="675"/>
          <line x1="0" y1="740" x2="1920" y2="740"/>
          <line x1="0" y1="830" x2="1920" y2="830"/>
          <line x1="0" y1="950" x2="1920" y2="950"/>
        </g>
      </svg>
    `),
  },
  {
    id: "celestial-moon",
    name: "Фазы луны & Орбиты",
    category: "vectors",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <radialGradient id="spaceBg" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="#151322"/>
            <stop offset="60%" stop-color="#0d0d17"/>
            <stop offset="100%" stop-color="#06060a"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#spaceBg)"/>
        <g transform="translate(960, 480)" stroke="#ffffff" fill="none">
          <!-- Концентрические кольца орбит -->
          <circle cx="0" cy="0" r="280" stroke-width="0.8" stroke-opacity="0.12" stroke-dasharray="6 6"/>
          <circle cx="0" cy="0" r="210" stroke-width="1" stroke-opacity="0.16"/>
          <circle cx="0" cy="0" r="140" stroke-width="0.8" stroke-opacity="0.12"/>
          <circle cx="0" cy="0" r="70" stroke-width="0.8" stroke-opacity="0.18" stroke-dasharray="2 4"/>
          <!-- Лунный серп по центру -->
          <path d="M -15,-40 A 45,45 0 0,0 20,40 A 38,38 0 0,1 -15,-40" 
                fill="#ffffff" fill-opacity="0.25" stroke="none"/>
          <!-- Орбитальные маркеры -->
          <circle cx="0" cy="-210" r="4" fill="#8b5cf6" fill-opacity="0.8" stroke="none"/>
          <circle cx="140" cy="0" r="3" fill="#ffffff" fill-opacity="0.5" stroke="none"/>
          <circle cx="-198" cy="70" r="2.5" fill="#f59e0b" fill-opacity="0.7" stroke="none"/>
        </g>
      </svg>
    `),
  },
  {
    id: "midnight-window",
    name: "Окно в полночь",
    category: "vectors",
    url: svgToDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="winSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#121829"/>
            <stop offset="100%" stop-color="#060910"/>
          </linearGradient>
          <radialGradient id="moonlight" cx="65%" cy="30%" r="50%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#winSky)"/>
        <rect width="100%" height="100%" fill="url(#moonlight)"/>
        <!-- Силуэт оконной рамы мансарды -->
        <g stroke="#05070d" stroke-width="26" fill="none">
          <!-- Внешняя рама -->
          <rect x="520" y="100" width="880" height="880" rx="8"/>
          <!-- Крестовина переплёта -->
          <line x1="960" y1="100" x2="960" y2="980"/>
          <line x1="520" y1="540" x2="1400" y2="540"/>
        </g>
        <!-- Тонкие блики на стекле -->
        <line x1="580" y1="200" x2="880" y2="480" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.08"/>
        <line x1="640" y1="200" x2="910" y2="440" stroke="#ffffff" stroke-width="1" stroke-opacity="0.05"/>
      </svg>
    `),
  },
];