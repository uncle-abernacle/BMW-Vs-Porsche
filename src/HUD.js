// HUD owns all DOM and canvas updates for the racing overlay. It draws gauges
// and the minimap in one place so gameplay objects stay focused on simulation.
export class HUD {
  constructor() {
    this.speedReadout = document.querySelector("#speed-readout");
    this.rpmReadout = document.querySelector("#rpm-readout");
    this.gearReadout = document.querySelector("#gear-readout");
    this.lapCurrentReadout = document.querySelector("#lap-current-readout");
    this.lapTotalReadout = document.querySelector("#lap-total-readout");
    this.positionReadout = document.querySelector("#position-readout");
    this.positionTotalReadout = document.querySelector("#position-total-readout");
    this.timerReadout = document.querySelector("#timer-readout");
    this.checkpointReadout = document.querySelector("#checkpoint-readout");
    this.speedNeedle = document.querySelector("#speed-needle");
    this.tachNeedle = document.querySelector("#tach-needle");
    this.minimapCanvas = document.querySelector("#minimap-canvas");
    this.minimapContext = this.minimapCanvas.getContext("2d");
  }

  update({
    speed,
    gear,
    lap,
    totalLaps,
    time,
    rpm,
    position = 1,
    totalRacers = 6,
    track,
    playerPosition,
    rivalPositions = [],
    checkpointName = "Start",
  }) {
    this.speedReadout.textContent = String(speed).padStart(3, "0");
    this.rpmReadout.textContent = (rpm / 1000).toFixed(1);
    this.gearReadout.textContent = gear;
    this.lapCurrentReadout.textContent = String(lap);
    this.lapTotalReadout.textContent = totalLaps > 0 ? `/ ${totalLaps}` : "/ Practice";
    this.positionReadout.textContent = String(position);
    this.positionTotalReadout.textContent = `/ ${totalRacers}`;
    this.timerReadout.textContent = this.#formatTime(time);
    this.checkpointReadout.textContent = checkpointName;

    this.#setNeedle(this.speedNeedle, speed, 0, 180);
    this.#setNeedle(this.tachNeedle, rpm, 800, 8200);
    this.#drawMiniMap(track, playerPosition, rivalPositions);
  }

  #setNeedle(element, value, min, max) {
    const normalized = Math.min(Math.max((value - min) / (max - min), 0), 1);
    const degrees = -126 + normalized * 252;
    element.style.transform = `translateX(-50%) rotate(${degrees}deg)`;
  }

  #drawMiniMap(track, playerPosition, rivalPositions) {
    if (!track || !track.centerLinePoints?.length || !playerPosition) {
      return;
    }

    const canvas = this.minimapCanvas;
    const context = this.minimapContext;
    const width = canvas.width;
    const height = canvas.height;
    const bounds = this.#getTrackBounds(track.centerLinePoints);
    const padding = 18;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(4, 8, 13, 0.82)";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(255, 255, 255, 0.72)";
    context.lineWidth = 4;
    context.lineJoin = "round";
    context.beginPath();

    track.centerLinePoints.forEach((point, index) => {
      const projected = this.#projectToMiniMap(point, bounds, width, height, padding);

      if (index === 0) {
        context.moveTo(projected.x, projected.y);
      } else {
        context.lineTo(projected.x, projected.y);
      }
    });

    context.closePath();
    context.stroke();

    context.strokeStyle = "rgba(246, 199, 68, 0.75)";
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, width - 1, height - 1);

    for (const checkpoint of track.checkpoints ?? []) {
      const projected = this.#projectToMiniMap(checkpoint.position, bounds, width, height, padding);
      context.fillStyle = checkpoint.id === 0 ? "#f6c744" : "#73d2ff";
      context.fillRect(projected.x - 2, projected.y - 2, 4, 4);
    }

    for (const rivalPosition of rivalPositions) {
      const projected = this.#projectToMiniMap(rivalPosition, bounds, width, height, padding);
      context.fillStyle = "#f05a35";
      context.beginPath();
      context.arc(projected.x, projected.y, 4, 0, Math.PI * 2);
      context.fill();
    }

    const player = this.#projectToMiniMap(playerPosition, bounds, width, height, padding);
    context.fillStyle = "#f4f7fb";
    context.beginPath();
    context.arc(player.x, player.y, 5, 0, Math.PI * 2);
    context.fill();
  }

  #getTrackBounds(points) {
    return points.reduce(
      (bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minZ: Math.min(bounds.minZ, point.z),
        maxZ: Math.max(bounds.maxZ, point.z),
      }),
      {
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
      },
    );
  }

  #projectToMiniMap(point, bounds, width, height, padding) {
    const trackWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const trackHeight = Math.max(bounds.maxZ - bounds.minZ, 1);
    const scale = Math.min((width - padding * 2) / trackWidth, (height - padding * 2) / trackHeight);
    const offsetX = (width - trackWidth * scale) * 0.5;
    const offsetY = (height - trackHeight * scale) * 0.5;

    return {
      x: offsetX + (point.x - bounds.minX) * scale,
      y: offsetY + (point.z - bounds.minZ) * scale,
    };
  }

  #formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds % 1) * 1000);

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
      milliseconds,
    ).padStart(3, "0")}`;
  }
}
