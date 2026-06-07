# BMW vs Porsche Racing

A complete starter project for a browser-based 3D arcade racing game inspired by PS2-era racers.

## Run Locally

Open `index.html` in a browser, or serve the folder with any static file server.

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Controls

- `W` / `ArrowUp`: accelerate
- `S` / `ArrowDown`: brake / reverse
- `A` / `ArrowLeft`: steer left
- `D` / `ArrowRight`: steer right
- `Space`: handbrake
- `R`: reset race

## Structure

- `index.html`: page shell, import map, canvas, HUD
- `styles.css`: full-screen game layout and racing HUD
- `src/main.js`: Three.js setup and game loop
- `src/Car.js`: placeholder vehicle model and arcade handling
- `src/Track.js`: flat starter oval, road markings, scenery, bounds
- `src/CameraController.js`: chase camera behavior
- `src/InputManager.js`: keyboard input state
- `src/HUD.js`: speed, lap, gear, and timer display

## GitHub Pages

This project is static and does not require a backend or build tools. Push it to GitHub and enable GitHub Pages from the repository settings.
