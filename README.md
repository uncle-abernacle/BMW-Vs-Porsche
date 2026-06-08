# BMW vs Porsche Racing

BMW vs Porsche Racing is a browser-based 3D arcade racing game inspired by early-2000s console racers. It runs as a static site with HTML, CSS, JavaScript, ES modules, and Three.js.

No backend, package install, bundler, or build step is required.

## Features

- PS2-style animated menus, vehicle selection, options, and championship flow
- Arcade driving physics with smooth steering, drifting, handbrake, reset, and MPH speed display
- Third-person chase camera with interpolation, tilt, and collision prevention
- Low-poly Alpine Pass race environment with checkpoints and lap detection
- Five AI opponents with reusable AI controller behavior
- Race HUD with speedometer, tachometer, lap, timer, position, and mini map
- Web Audio engine, tire, collision, menu, countdown, mute, and volume controls
- Static GitHub Pages-ready file paths

## Controls

- `W` / `ArrowUp`: accelerate
- `S` / `ArrowDown`: brake / reverse
- `A` / `ArrowLeft`: steer left
- `D` / `ArrowRight`: steer right
- `Space`: handbrake
- `R`: reset vehicle
- `Enter`: confirm menu selection
- `Esc`: go back in menus

## Installation

Clone the repository:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
cd YOUR-REPOSITORY
```

There are no dependencies to install. Three.js is loaded through the import map in `index.html`.

## Run Locally

Use any static file server from the project root:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

Modern browsers usually block ES modules loaded from `file://`, so a static server is recommended for local testing.

## GitHub Pages Deployment

1. Push this project to a GitHub repository.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Under `Build and deployment`, choose `Deploy from a branch`.
5. Select the branch that contains this project, usually `main` or `master`.
6. Select `/ (root)` as the folder.
7. Save the settings.

GitHub Pages will serve `index.html` from the repository root. All local asset and module paths use `./` relative paths, so the game works from both the root domain and a project Pages URL such as:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/
```

## Production Structure

```text
BMW VS PORSCHE/
├── .gitignore
├── .nojekyll
├── README.md
├── assets/
│   └── vehicles/
├── index.html
├── styles.css
└── src/
    ├── AIController.js
    ├── AudioManager.js
    ├── CameraController.js
    ├── Car.js
    ├── ChampionshipManager.js
    ├── HUD.js
    ├── InputManager.js
    ├── MenuController.js
    ├── Track.js
    ├── VehicleCatalog.js
    ├── VisualPolish.js
    └── main.js
```

## Module Notes

- `index.html` defines the Three.js import map and loads `./src/main.js`.
- All project modules import each other with relative `./` paths.
- No generated files or local development folders are required for deployment.
- `.nojekyll` is included so GitHub Pages serves the repository as plain static files.
