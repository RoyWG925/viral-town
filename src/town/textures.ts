import * as THREE from "three";

// Procedural canvas textures. Everything is drawn in code: no image assets.

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function toTexture(c: HTMLCanvasElement, repeat?: [number, number]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Small seeded PRNG so textures look the same on every load.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function cobbleTexture(repeat: [number, number]) {
  const [c, g] = canvas(512, 512);
  const r = rng(7);
  g.fillStyle = "#8a6a5a";
  g.fillRect(0, 0, 512, 512);
  const palette = ["#e8b48c", "#d99a73", "#f0c29b", "#c98a68", "#e7a77c", "#d4b08a", "#b9c6c9", "#c7a3c2"];
  const rows = 10;
  const rh = 512 / rows;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 ? rh * 0.6 : 0;
    for (let x = -offset; x < 512; ) {
      const w = rh * (1.0 + r() * 0.7);
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      roundRect(g, x + 3, row * rh + 3, w - 6, rh - 6, 10);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.10)";
      roundRect(g, x + 6, row * rh + 5, w - 14, (rh - 10) * 0.45, 8);
      g.fill();
      x += w;
    }
  }
  return toTexture(c, repeat);
}

export function sidewalkTexture(repeat: [number, number]) {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  g.fillStyle = "#b8846a";
  g.fillRect(0, 0, 256, 256);
  const tiles = ["#e9b796", "#e3a986", "#efc3a2", "#dca07e", "#f0cbb0"];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      g.fillStyle = tiles[Math.floor(r() * tiles.length)];
      roundRect(g, x * 64 + 2, y * 64 + 2, 60, 60, 6);
      g.fill();
    }
  return toTexture(c, repeat);
}

export function asphaltTexture(repeat: [number, number]) {
  const [c, g] = canvas(256, 256);
  const r = rng(3);
  g.fillStyle = "#5d5f6b";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const v = 80 + Math.floor(r() * 40);
    g.fillStyle = `rgba(${v},${v},${v + 8},0.5)`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return toTexture(c, repeat);
}

export function grassTexture(repeat: [number, number]) {
  const [c, g] = canvas(256, 256);
  const r = rng(5);
  g.fillStyle = "#93c56f";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() > 0.5 ? "rgba(120,180,90,0.55)" : "rgba(170,210,120,0.45)";
    g.beginPath();
    g.arc(r() * 256, r() * 256, 2 + r() * 5, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c, repeat);
}

export function stripeTexture(a: string, b: string, stripes = 8) {
  const [c, g] = canvas(256, 64);
  const w = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * w, 0, w, 64);
  }
  return toTexture(c);
}

export function signTexture(zh: string, en: string, bg: string, fg: string) {
  const [c, g] = canvas(768, 192);
  g.fillStyle = bg;
  roundRect(g, 6, 6, 756, 180, 36);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "rgba(255,255,255,0.35)";
  roundRect(g, 18, 18, 732, 156, 28);
  g.stroke();
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = 'bold 84px "Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif';
  g.fillText(zh, 384, 82);
  g.font = 'bold 34px "Arial Rounded MT Bold","Segoe UI",sans-serif';
  g.fillText(en, 384, 150);
  return toTexture(c);
}

export function bannerTexture() {
  const [c, g] = canvas(1024, 256);
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, "#c2332f");
  grad.addColorStop(1, "#e2573a");
  g.fillStyle = grad;
  roundRect(g, 0, 0, 1024, 256, 40);
  g.fill();
  g.fillStyle = "#ffe08a";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = 'bold 110px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  g.fillText("霧港燈籠節", 512, 110);
  g.font = 'bold 44px "Segoe UI",sans-serif';
  g.fillText("LANTERN FESTIVAL · TONIGHT 20:00", 512, 205);
  return toTexture(c);
}

export function bubbleTexture(text: string) {
  const [c, g] = canvas(128, 112);
  g.fillStyle = "#ffffff";
  roundRect(g, 6, 6, 116, 76, 30);
  g.fill();
  g.beginPath();
  g.moveTo(52, 80);
  g.lineTo(64, 104);
  g.lineTo(76, 80);
  g.fill();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = '48px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.fillStyle = "#333";
  g.fillText(text, 64, 46);
  return toTexture(c);
}

// Shop interiors seen through the window: shelves and goods drawn per shop type.
export function interiorTexture(kind: string, accent: string) {
  const [c, g] = canvas(512, 320);
  const r = rng(kind.length * 31 + accent.length);
  const wall = g.createLinearGradient(0, 0, 0, 320);
  wall.addColorStop(0, "#fff6e3");
  wall.addColorStop(1, "#f1d9b8");
  g.fillStyle = wall;
  g.fillRect(0, 0, 512, 320);
  // ceiling lamp glow
  const glowGrad = g.createRadialGradient(256, 10, 10, 256, 40, 260);
  glowGrad.addColorStop(0, "rgba(255,240,200,0.9)");
  glowGrad.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = glowGrad;
  g.fillRect(0, 0, 512, 320);
  g.fillStyle = "#3a2a22";
  [150, 380].forEach((x) => {
    g.fillRect(x - 2, 0, 4, 30);
    g.beginPath();
    g.moveTo(x - 26, 44);
    g.lineTo(x + 26, 44);
    g.lineTo(x + 12, 28);
    g.lineTo(x - 12, 28);
    g.fill();
  });
  const shelf = (y: number) => {
    g.fillStyle = "#a0714f";
    g.fillRect(20, y, 472, 10);
  };
  const items = (y: number, draw: (x: number, y: number) => void, step = 34) => {
    for (let x = 34; x < 480; x += step + r() * 8) draw(x, y);
  };
  switch (kind) {
    case "bakery":
      [130, 210].forEach((y) => {
        shelf(y);
        items(y, (x, yy) => {
          g.fillStyle = r() > 0.5 ? "#d9913f" : "#c0702a";
          g.beginPath();
          g.ellipse(x, yy - 14, 15, 11, 0, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = "rgba(255,230,180,0.8)";
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x - 7, yy - 18);
          g.lineTo(x + 7, yy - 12);
          g.stroke();
        });
      });
      break;
    case "flower":
      [150, 235].forEach((y) => {
        shelf(y);
        items(y, (x, yy) => {
          g.fillStyle = "#6a8caf";
          g.fillRect(x - 12, yy - 26, 24, 26);
          for (let k = 0; k < 5; k++) {
            g.fillStyle = ["#ff6fa0", "#ffd23f", "#b388ff", "#ff8a65", "#ffffff"][Math.floor(r() * 5)];
            g.beginPath();
            g.arc(x - 10 + r() * 20, yy - 34 - r() * 22, 7, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = "#5fb256";
          g.fillRect(x - 2, yy - 40, 4, 16);
        }, 40);
      });
      break;
    case "cafe":
      g.fillStyle = "#2f3b36";
      g.fillRect(300, 70, 170, 110);
      g.fillStyle = "#ffffff";
      g.font = "bold 26px sans-serif";
      g.fillText("MENU", 345, 105);
      g.font = "18px sans-serif";
      ["拿鐵  80", "美式  60", "可可  70"].forEach((t, i) => g.fillText(t, 325, 135 + i * 22));
      g.fillStyle = "#8a5a3a";
      g.fillRect(20, 220, 472, 100);
      g.fillStyle = "#c0c6cc";
      g.fillRect(70, 170, 90, 50);
      g.fillStyle = "#3a3a3a";
      g.fillRect(90, 185, 50, 10);
      items(220, (x, yy) => {
        if (x > 200) return;
        g.fillStyle = "#ffffff";
        g.fillRect(x + 150, yy - 18, 16, 18);
      }, 26);
      break;
    case "books":
      [110, 190, 270].forEach((y) => {
        shelf(y);
        for (let x = 24; x < 488; ) {
          const w = 8 + r() * 10;
          const h = 34 + r() * 26;
          g.fillStyle = ["#e2574c", "#3a86ff", "#ffbe0b", "#8338ec", "#2ec4b6", "#ff8fab", "#3d405b"][Math.floor(r() * 7)];
          g.fillRect(x, y - h, w, h);
          x += w + 2;
        }
      });
      break;
    case "news":
      g.fillStyle = "#6b4f3a";
      g.fillRect(40, 200, 200, 20);
      g.fillRect(290, 200, 200, 20);
      g.fillStyle = "#2b2b2b";
      g.fillRect(90, 150, 70, 50);
      g.fillRect(340, 150, 70, 50);
      g.fillStyle = "#9fd6ff";
      g.fillRect(96, 156, 58, 38);
      g.fillRect(346, 156, 58, 38);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = "#f5f2e8";
        g.fillRect(40 + i * 76, 60, 60, 80);
        g.fillStyle = "#555";
        for (let k = 0; k < 5; k++) g.fillRect(46 + i * 76, 72 + k * 12, 48, 4);
      }
      break;
    default: {
      g.fillStyle = accent;
      g.fillRect(40, 230, 432, 90);
      g.fillStyle = "#c9b28c";
      g.fillRect(60, 60, 180, 120);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = ["#ffffff", "#ffd23f", "#9fd6ff"][i % 3];
        g.fillRect(70 + (i % 4) * 42, 72 + Math.floor(i / 4) * 52, 34, 42);
      }
      g.fillStyle = "#3d405b";
      g.fillRect(330, 40, 6, 180);
      g.fillStyle = accent;
      g.fillRect(336, 44, 90, 56);
    }
  }
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.beginPath();
  g.moveTo(330, 0);
  g.lineTo(420, 0);
  g.lineTo(200, 320);
  g.lineTo(110, 320);
  g.fill();
  return toTexture(c);
}

export function iconTexture(icon: string, bg: string) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = bg;
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = '130px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.fillText(icon, 128, 140);
  return toTexture(c);
}

export function chalkTexture(lines: string[]) {
  const [c, g] = canvas(256, 320);
  g.fillStyle = "#8a5a3a";
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = "#2f3b36";
  g.fillRect(14, 14, 228, 292);
  g.fillStyle = "#f6f1e3";
  g.textAlign = "center";
  g.font = 'bold 38px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  lines.forEach((t, i) => g.fillText(t, 128, 80 + i * 66));
  g.strokeStyle = "rgba(246,241,227,0.6)";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(50, 110);
  g.lineTo(206, 110);
  g.stroke();
  return toTexture(c);
}

// Greyscale wall patterns; the material colour tints them.
export function wallTexture(style: "brick" | "plaster", repeat: [number, number]) {
  const [c, g] = canvas(256, 256);
  const r = rng(style === "brick" ? 21 : 22);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  if (style === "brick") {
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 32 : 0;
      for (let x = -off; x < 256; x += 64) {
        const v = 225 + Math.floor(r() * 30);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + 3, row * 32 + 3, 58, 26);
      }
    }
    g.globalCompositeOperation = "destination-over";
    g.fillStyle = "#c8c8c8";
    g.fillRect(0, 0, 256, 256);
  } else {
    for (let i = 0; i < 500; i++) {
      const v = 228 + Math.floor(r() * 27);
      g.fillStyle = `rgba(${v},${v},${v},0.6)`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 2 + r() * 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c, repeat);
}

export function planksTexture(repeat: [number, number]) {
  const [c, g] = canvas(256, 256);
  const r = rng(13);
  for (let i = 0; i < 8; i++) {
    const v = 150 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v + 30},${v},${v - 40})`;
    g.fillRect(0, i * 32, 256, 30);
    g.fillStyle = "rgba(60,40,20,0.5)";
    g.fillRect(0, i * 32 + 30, 256, 2);
    g.fillRect(Math.floor(r() * 256), i * 32, 2, 30);
  }
  return toTexture(c, repeat);
}

export function waterTexture(repeat: [number, number]) {
  const [c, g] = canvas(256, 256);
  const r = rng(17);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(170,220,255,0.9)";
  g.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 10, y - 4, x + 22, y);
    g.stroke();
  }
  return toTexture(c, repeat);
}

// A lived-in room seen through a house window: curtains, a lamp and a picture.
export function homeTexture(curtain: string) {
  const [c, g] = canvas(256, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#fff3d6");
  grad.addColorStop(1, "#f0d2a8");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#c79a6b";
  g.fillRect(150, 70, 60, 46);
  g.fillStyle = "#7fb069";
  g.fillRect(156, 76, 48, 34);
  g.fillStyle = "#e9c46a";
  g.beginPath();
  g.arc(70, 120, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#6b4f3a";
  g.fillRect(66, 146, 8, 70);
  g.fillStyle = curtain;
  g.fillRect(0, 0, 48, 256);
  g.fillRect(208, 0, 48, 256);
  g.fillStyle = "rgba(0,0,0,0.12)";
  for (let x = 8; x < 48; x += 12) g.fillRect(x, 0, 3, 256);
  for (let x = 216; x < 256; x += 12) g.fillRect(x, 0, 3, 256);
  return toTexture(c);
}
