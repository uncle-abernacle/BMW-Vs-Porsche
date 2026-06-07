// HUD owns all DOM updates for the racing overlay. The 3D scene never needs to
// know which elements exist, and the UI can be restyled without touching game
// logic.
export class HUD {
  constructor() {
    this.speedReadout = document.querySelector("#speed-readout");
    this.gearReadout = document.querySelector("#gear-readout");
    this.lapReadout = document.querySelector("#lap-readout");
    this.timerReadout = document.querySelector("#timer-readout");
  }

  update({ speed, gear, lap, totalLaps, time }) {
    this.speedReadout.textContent = String(speed).padStart(3, "0");
    this.gearReadout.textContent = gear;
    this.lapReadout.textContent = `Lap ${lap} / ${totalLaps}`;
    this.timerReadout.textContent = this.#formatTime(time);
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
