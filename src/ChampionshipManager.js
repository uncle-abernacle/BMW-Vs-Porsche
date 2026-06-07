const POINTS_BY_POSITION = [10, 8, 6, 4, 2, 1];

export class ChampionshipManager {
  constructor() {
    this.schedule = [
      "German Countryside Circuit",
      "Autobahn Sprint",
      "Alpine Pass",
    ];
    this.active = false;
    this.currentRaceIndex = 0;
    this.standings = [];
  }

  start(driverNames) {
    this.active = true;
    this.currentRaceIndex = 0;
    this.standings = driverNames.map((name) => ({
      name,
      points: 0,
      wins: 0,
      lastPosition: null,
    }));
  }

  stop() {
    this.active = false;
  }

  getCurrentRaceName() {
    return this.schedule[this.currentRaceIndex] ?? this.schedule[this.schedule.length - 1];
  }

  recordRace(results) {
    const normalized = results.slice(0, POINTS_BY_POSITION.length).map((result, index) => ({
      ...result,
      position: index + 1,
      points: POINTS_BY_POSITION[index],
    }));

    for (const result of normalized) {
      const standing = this.standings.find((entry) => entry.name === result.name);

      if (!standing) continue;

      standing.points += result.points;
      standing.lastPosition = result.position;
      if (result.position === 1) standing.wins += 1;
    }

    this.standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (a.lastPosition ?? 99) - (b.lastPosition ?? 99);
    });

    return {
      raceName: this.getCurrentRaceName(),
      raceNumber: this.currentRaceIndex + 1,
      totalRaces: this.schedule.length,
      results: normalized,
      standings: this.getStandings(),
      champion: this.getChampion(),
      isFinalRace: this.currentRaceIndex >= this.schedule.length - 1,
    };
  }

  advanceRace() {
    this.currentRaceIndex = Math.min(this.currentRaceIndex + 1, this.schedule.length - 1);
  }

  getStandings() {
    return this.standings.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  }

  getChampion() {
    return this.getStandings()[0] ?? null;
  }
}
