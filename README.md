# RoletaLab — Análise Quantitativa & OCR de Roleta Europeia (0–36)

Aplicação dedicada exclusivamente à **Roleta Europeia (0–36)** com arquitetura em 4 camadas desacopladas:

1. **Captura & Navegador Embutido Split-Screen**: Navegador integrado ajustável (`45%` / `56%` / `66%`) com mesa jogável (`mesa://europeia-ao-vivo`), suporte a URLs externas, Screen Capture API (`getDisplayMedia`), editor visual de ROI com 4 cantos arrastáveis e perfis pré-calibrados (**Evolution**, **Pragmatic**, **Creedroomz**, **Playtech**, **Lightning / XXXtreme**).
2. **Pré-Processamento & OCR**: Filtro anti-lag `< 1 ms` (`dHash` 64-bit global + `leftEdgeHash` 35% + `meanLuma`), escala inteligente, CLAHE local (`4×2`, `clipFactor = 2.6`), segmentação de células com inversão para **Tesseract.js**, amostragem de cor HSV em 8 pontos com Conta-Gotas e validação cruzada estrita `Número ↔ Cor`.
3. **Reconciliação Temporal**: Máquina de estados que elimina leituras duplicadas (shift negativo `0..-3`), confirma novos giros (`shift +1..+4`) e deteta trocas de mesa automaticamente.
4. **Motor Quantitativo, Entropia, Walk-Forward 0s & Simulador Monte Carlo**: Roda física e tapete sincronizados, Markov Ordem 1, Âncora & Vizinhos `±2`, detetor de imprevisibilidade por Entropia de Shannon, Aposta Mestra com Stop-Loss/Stop-Win, exportação **CSV/JSON** e simulador **Monte Carlo** comparando *Flat Betting*, *D'Alembert* e *Martingale com Teto* (`2.70%` House Edge).

---

## Como Baixar e Instalar pelo GitHub

### Opção 1 — Download Direto via GitHub Releases (Web ZIP & Android APK)
Sempre que é publicada uma tag (ex.: `v1.0.0`) ou executado o workflow **Build & Release** na aba **Actions** do GitHub:
1. Aceda à secção **Releases** do repositório no GitHub.
2. Descarregue o pacote pretendido:
   - **`RoletaLab-Android.apk`** — Instalador direto para telemóveis Android.
   - **`RoletaLab-Web.zip`** — Build estático pronto para alojar ou abrir num servidor local.

### Opção 2 — Instalar como App (PWA) no Navegador (Android / iOS / Desktop)
Ao abrir a aplicação web no Chrome, Edge ou Safari, clique no botão **Instalar App** na barra de ferramentas (ou *Adicionar ao ecrã inicial* no Safari iOS) para executar em modo standalone.

### Opção 3 — Clonar do GitHub e Executar Localmente
```bash
git clone https://github.com/<seu-usuario>/<seu-repositorio>.git
cd <seu-repositorio>
npm install
npm run dev
```
A aplicação ficará disponível em `http://localhost:3000`.

### Opção 4 — Gerar o APK Android Localmente (Capacitor)
Requer **Node.js 20+**, **JDK 17** e **Android SDK**:
```bash
npm install
npm run build
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```
O APK será gerado em `android/app/build/outputs/apk/debug/app-debug.apk`.
