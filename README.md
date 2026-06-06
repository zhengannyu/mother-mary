# Mother Mary — 飄動紅紗 Landing

純前端 Vite 專案。Index landing screen，背景是一塊**真・布料物理模擬**（verlet 彈簧網）算出來的紅色半透薄紗：自由漂浮、隨噪聲風場緩緩 billow、邊緣溶解透亮、滑鼠滑過推出漣漪。前景疊上 Mother Mary 主題的聖袍意象標題與引言。

效果靈感：https://codepen.io/ksenia-k/full/ExqgveK

## 開發

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 產出到 dist/
npm run preview  # 預覽 build 結果
```

## 結構

- `index.html` — 版面、字體、文案
- `src/style.css` — 視覺樣式、進場動畫、暗角與顆粒
- `src/veil/physics.js` — verlet 布料解算器（粒子網格 + 距離約束 + 風場），純 JS、無依賴
- `src/veil/veil.js` — Three.js 場景：把物理網格即時三角化、重算法線，半透緞面薄紗材質（sheen + 背光透射 + Fresnel 邊緣 + 邊界溶解）
- `src/main.js` — 進入點

## 調整重點

**布料動態** — `src/veil/veil.js` 的 `SIM` 物件：

- `windStrength` / `windSpeed` — 風的強度與快慢（billow 幅度）
- `gravity` — 重力（自由漂浮所以很小）
- `homeStrength` / `sway` — 鬆綁定回畫面的力 / 整體漂移幅度
- `damping` — 阻尼（越接近 1 越飄、餘韻越長）
- `iterations` / `stiffness` — 約束迭代與硬度（布越挺）
- 網格解析度：`SETTINGS.desktop` / `SETTINGS.mobile`

**質感與顏色** — `material` 的 uniforms：

- `uColorDeep` / `uColorLit` — 摺痕陰影紅 / 受光紅
- `uSheen` / `uSpec` — 邊緣金澤 / 緞面高光
- `uBaseAlpha` — 基礎透明度（越低越像薄紗、越透）
- `uShininess` — 高光集中度

文案在 `index.html`（標題 `Mater Dei`、引言 Luke 1:48），配色 token 在 `src/style.css` 的 `:root`。
