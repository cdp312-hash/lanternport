"""Simulates Lanternport one trading day at a time.

Storylines (data/storylines.yaml) start at random, unfold in stages over days, and produce news.
Each news item can move prices: a gap at the next open (which a player reacting to the news can't
catch) and a drift over the following days (which they can). Prices also follow market, sector and
company randomness, so news explains a lot of the movement but never all of it.

The whole world is seeded: the same seed always produces the same history.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

DATA_DIR = Path(__file__).parent / "data"
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")

NEW_BOSS_FIRST = ["Hattie", "Monty", "Pip", "Rosalind", "Archie", "Bea", "Ziggy", "Ottilie", "Clem", "Wilf", "Nettie",
                  "Ferdinand", "Marigold", "Rupert", "Esme", "Jasper", "Delphine", "Barnaby", "Tallulah", "Hector"]
NEW_BOSS_LAST = ["Bramble", "Wobble", "Tinker", "Larkspur", "Pennywhistle", "Fairbairn", "Quill", "Snodgrass", "Honeywell",
                 "Marchbank", "Crumpet", "Fenwick", "Gladstone", "Pickering", "Thistlewood", "Buttons"]
STORM_NAMES = ["Gertrude", "Bartholomew", "Doris", "Cuthbert", "Mabel", "Ernest", "Winifred", "Horace", "Ethel", "Percy"]

# Daily chance of a new storyline starting.
COMPANY_RATE = 0.05  # per company, when it has no storyline running
SECTOR_RATE = 0.02
MARKET_RATE = 0.025
WEATHER_RATE = 0.035  # only when a weather storyline is in season
FEATURE_RATE = 0.6


# --- Loading the world ---------------------------------------------------------------

@dataclass
class World:
    config: dict
    districts: dict[str, dict]
    sectors: dict[str, dict]
    companies: list[dict]
    characters: dict[str, dict]
    features: list[str]
    lessons: dict[str, str]
    storylines: list[dict]

    def __post_init__(self):
        self.by_id = {c["id"]: c for c in self.companies}
        self.index = {c["id"]: i for i, c in enumerate(self.companies)}


class WorldError(ValueError):
    pass


def load_world(data_dir: Path = DATA_DIR) -> World:
    cfg = yaml.safe_load((data_dir / "world.yaml").read_text(encoding="utf-8"))
    companies = yaml.safe_load((data_dir / "companies.yaml").read_text(encoding="utf-8"))
    stories = yaml.safe_load((data_dir / "storylines.yaml").read_text(encoding="utf-8"))
    world = World(
        config=cfg,
        districts={d["id"]: d for d in cfg["districts"]},
        sectors={s["id"]: s for s in cfg["sectors"]},
        companies=companies,
        characters=cfg["characters"],
        features=cfg.get("features", []),
        lessons=stories["lessons"],
        storylines=stories["storylines"],
    )
    validate(world)
    return world


def validate(world: World) -> None:
    """Catch typos in the YAML early, with messages that say where."""
    ids = set()
    for c in world.companies:
        where = f"companies.yaml: {c.get('id', '?')}"
        for key in ("id", "name", "ticker", "sector", "district", "what", "product", "boss", "trait"):
            if not c.get(key):
                raise WorldError(f"{where}: missing '{key}'")
        if c["id"] in ids:
            raise WorldError(f"{where}: duplicate id")
        ids.add(c["id"])
        if c["sector"] not in world.sectors:
            raise WorldError(f"{where}: unknown sector '{c['sector']}'")
        if c["district"] not in world.districts:
            raise WorldError(f"{where}: unknown district '{c['district']}'")
        if c.get("weather") not in (None, "hot", "cold", "rain"):
            raise WorldError(f"{where}: weather must be hot, cold or rain")
    for c in world.companies:
        for link in ("rival", "supplier", "customer"):
            if c.get(link) and c[link] not in ids:
                raise WorldError(f"companies.yaml: {c['id']}: {link} '{c[link]}' is not a company id")
    known_targets = {"company", "rival", "supplier", "customer", "bidder", "sector", "market",
                     "weather:hot", "weather:cold", "weather:rain"}
    for s in world.storylines:
        if s.get("scope") not in ("company", "sector", "market", "weather"):
            raise WorldError(f"storylines.yaml: {s.get('id')}: scope must be company, sector, market or weather")
        for stage in s["stages"]:
            for variant in stage.get("branches", [stage]):
                if variant.get("kind") not in world.lessons:
                    raise WorldError(f"storylines.yaml: {s['id']}: kind '{variant.get('kind')}' has no lesson")
                if not variant.get("headlines"):
                    raise WorldError(f"storylines.yaml: {s['id']}: a stage has no headlines")
                for eff in variant.get("effects", []):
                    t = eff["target"]
                    ok = t in known_targets or (t.startswith("sector:") and t[7:] in world.sectors) or \
                        (t.startswith("company:") and t[8:] in ids)
                    if not ok:
                        raise WorldError(f"storylines.yaml: {s['id']}: unknown target '{t}'")


# --- Simulation ---------------------------------------------------------------------------

@dataclass
class News:
    id: int
    day: int  # trading-day index; the news came out after this day's close
    headline: str
    body: str
    kind: str
    importance: int
    scope: str
    story: int  # storyline instance id (-1 for features)
    companies: list[str]  # companies mentioned (for links)
    sector: str | None
    effects: dict[str, int] = field(default_factory=dict)  # company id -> expected direction of the catchable drift


@dataclass
class Simulation:
    world: World
    calendar: pd.DatetimeIndex
    bars: np.ndarray  # (companies, days, 4): open, high, low, close
    news: list[News]
    weather: list[dict]  # per day: {temp, sky}
    bosses: list[dict[str, str]]  # per day: company id -> boss (bosses change after resignations)

    def index_level(self) -> np.ndarray:
        """Equal-weight index of all companies, 1000 on the first day."""
        rets = self.bars[:, 1:, 3] / self.bars[:, :-1, 3]
        level = np.cumprod(np.r_[1.0, rets.mean(axis=0)]) * 1000
        return level


def _pick(rng: np.random.Generator, items):
    return items[int(rng.integers(len(items)))]


def _uniform(rng: np.random.Generator, pair) -> float:
    lo, hi = sorted(pair)
    return float(rng.uniform(lo, hi))


def _days(rng: np.random.Generator, spec) -> int:
    if isinstance(spec, (list, tuple)):
        return int(rng.integers(spec[0], spec[1] + 1))
    return int(spec)


def possessive(name: str) -> str:
    return f"{name}'" if name.endswith("s") else f"{name}'s"


def _fill(text: str, values: dict[str, str]) -> str:
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), text)


class _Engine:
    def __init__(self, world: World, calendar: pd.DatetimeIndex, seed: int, reset_bosses_at: int | None = None):
        self.reset_at = reset_bosses_at
        self.w = world
        self.cal = calendar
        self.T = len(calendar)
        self.C = len(world.companies)
        self.rng = np.random.default_rng(seed)
        self.gap = np.zeros((self.C, self.T + 1))
        self.drift = np.zeros((self.C, self.T + 1))
        self.news: list[News] = []
        self.pending: dict[int, list] = {}  # day -> [(instance, stage_index)]
        self.instances: list[dict] = []
        self.busy_until = np.full(self.C, -1)
        self.bosses = {c["id"]: c["boss"] for c in world.companies}
        self.boss_log: list[dict[str, str]] = []
        self.weather_active: dict[str, int] = {}  # kind -> until day
        chars = world.characters
        self.people = {k: v["name"] for k, v in chars.items()}

    # Which companies an effect hits.
    def targets(self, target: str, inst: dict) -> list[int]:
        w, b = self.w, inst["binding"]
        if target in ("company", "rival", "supplier", "customer", "bidder"):
            cid = b.get(target)
            return [w.index[cid]] if cid else []
        if target == "sector":
            return [w.index[c["id"]] for c in w.companies if c["sector"] == b.get("sector")]
        if target.startswith("sector:"):
            return [w.index[c["id"]] for c in w.companies if c["sector"] == target[7:]]
        if target.startswith("company:"):
            return [w.index[target[8:]]]
        if target.startswith("weather:"):
            return [w.index[c["id"]] for c in w.companies if c.get("weather") == target[8:]]
        if target == "market":
            return list(range(self.C))
        return []

    def start(self, story: dict, t: int, binding: dict) -> None:
        inst = {"id": len(self.instances), "story": story, "binding": binding, "state": {}}
        self.instances.append(inst)
        last = t
        for i, stage in enumerate(story["stages"]):
            day = t + _days(self.rng, stage["at"])
            last = max(last, day)
            self.pending.setdefault(day, []).append((inst, i))
        if story["scope"] == "company":
            idx = self.w.index[binding["company"]]
            self.busy_until[idx] = last + 3

    def bind_company(self, story: dict, company: dict) -> dict | None:
        req = story.get("requires", {})
        if "sectors" in req and company["sector"] not in req["sectors"]:
            return None
        for link in req.get("has", []):
            if not company.get(link):
                return None
        b = {"company": company["id"], "sector": company["sector"]}
        for link in ("rival", "supplier", "customer"):
            if company.get(link):
                b[link] = company[link]
        others = [c["id"] for c in self.w.companies if c["sector"] == company["sector"] and c["id"] != company["id"]]
        b["bidder"] = _pick(self.rng, others) if others else _pick(self.rng, [c["id"] for c in self.w.companies if c["id"] != company["id"]])
        return b

    def values(self, inst: dict, t: int) -> dict[str, str]:
        w, b = self.w, inst["binding"]
        v = dict(self.people)
        v["storm"] = inst["state"].setdefault("storm", _pick(self.rng, STORM_NAMES))
        if "company" in b:
            c = w.by_id[b["company"]]
            v.update(company=c["name"], company_s=possessive(c["name"]), boss=self.bosses[c["id"]], trait=c["trait"], product=c["product"],
                     what=c["what"], district=w.districts[c["district"]]["name"])
            if "newboss" not in inst["state"]:
                inst["state"]["newboss"] = f"{_pick(self.rng, NEW_BOSS_FIRST)} {_pick(self.rng, NEW_BOSS_LAST)}"
            v["newboss"] = inst["state"]["newboss"]
        for link in ("rival", "supplier", "customer", "bidder"):
            if b.get(link):
                v[link] = w.by_id[b[link]]["name"]
        if b.get("sector"):
            v["sector"] = w.sectors[b["sector"]]["name"]
        return v

    def apply(self, eff: dict, inst: dict, t: int) -> dict[str, int]:
        idx = self.targets(eff["target"], inst)
        if not idx:
            return {}
        rng = self.rng
        g = _uniform(rng, eff.get("gap", [0, 0]))
        days = _days(rng, eff.get("days", 1))
        if "fade" in eff:
            expected = -int(np.sign(np.mean(eff.get("gap", [0, 0]))))
            total = -g * _uniform(rng, eff["fade"]) if rng.random() >= eff.get("fail", 0) else 0.0
        else:
            mid = np.mean(eff.get("drift", [0, 0]))
            expected = int(np.sign(mid)) if abs(mid) > 1e-9 else 0
            total = _uniform(rng, eff.get("drift", [0, 0])) if rng.random() >= eff.get("fail", 0) else 0.0
        span = list(range(t + 1, min(t + 1 + days, self.T)))
        weights = rng.dirichlet(np.ones(len(span)) * 3) if len(span) > 1 else np.ones(len(span))
        for i in idx:
            if t + 1 <= self.T:
                self.gap[i, t + 1] += g
            for d, s in zip(span, weights):
                self.drift[i, d] += total * s
        return {self.w.companies[i]["id"]: expected for i in idx} if expected else {}

    def emit_stage(self, inst: dict, i: int, t: int) -> None:
        stage = inst["story"]["stages"][i]
        variant = stage
        if "branches" in stage:
            options = [br for br in stage["branches"] if br.get("when") in (None, inst["state"].get("then"))]
            if not options:
                return
            p = np.array([br.get("p", 1.0) for br in options], dtype=float)
            variant = options[int(self.rng.choice(len(options), p=p / p.sum()))]
        if variant.get("then"):
            inst["state"]["then"] = variant["then"]
        vals = self.values(inst, t)
        effects: dict[str, int] = {}
        for eff in variant.get("effects", []):
            for cid, sign in self.apply(eff, inst, t).items():
                effects[cid] = effects.get(cid, 0) + sign
        effects = {k: int(np.sign(v)) for k, v in effects.items() if v}
        b = inst["binding"]
        texts = " ".join(variant["headlines"] + variant.get("bodies", []))
        mentioned = [b["company"]] if b.get("company") else []
        mentioned += [b[k] for k in ("bidder", "rival", "supplier", "customer") if b.get(k) and "{" + k + "}" in texts]
        self.news.append(News(
            id=len(self.news), day=t, headline=_fill(_pick(self.rng, variant["headlines"]), vals),
            body=_fill(_pick(self.rng, variant["bodies"]), vals) if variant.get("bodies") else "",
            kind=variant["kind"], importance=int(variant.get("importance", 1)), scope=inst["story"]["scope"],
            story=inst["id"], companies=list(dict.fromkeys(mentioned)), sector=b.get("sector"), effects=effects,
        ))
        if variant["kind"] == "new_boss" and b.get("company"):
            self.bosses[b["company"]] = vals["newboss"]
        if inst["story"]["scope"] == "weather" and i == 0:
            self.weather_active[variant["kind"]] = t + 7

    def maybe_start(self, t: int) -> None:
        w, rng = self.w, self.rng
        month = self.cal[t].month
        by_scope: dict[str, list[dict]] = {}
        for s in w.storylines:
            req = s.get("requires", {})
            if "months" in req and month not in req["months"]:
                continue
            by_scope.setdefault(s["scope"], []).append(s)

        def choose(stories):
            weights = np.array([s.get("weight", 1.0) for s in stories], dtype=float)
            return stories[int(rng.choice(len(stories), p=weights / weights.sum()))]

        if by_scope.get("market") and rng.random() < MARKET_RATE:
            self.start(choose(by_scope["market"]), t, {})
        if by_scope.get("sector") and rng.random() < SECTOR_RATE:
            self.start(choose(by_scope["sector"]), t, {"sector": _pick(rng, list(w.sectors))})
        if by_scope.get("weather") and rng.random() < WEATHER_RATE and not any(u >= t for u in self.weather_active.values()):
            self.start(choose(by_scope["weather"]), t, {})
        for ci, c in enumerate(w.companies):
            if self.busy_until[ci] >= t or rng.random() >= COMPANY_RATE:
                continue
            stories = by_scope.get("company", [])
            for _ in range(5):
                story = choose(stories)
                binding = self.bind_company(story, c)
                if binding:
                    self.start(story, t, binding)
                    break

    def weather_for(self, t: int) -> dict:
        d = self.cal[t]
        season = np.cos((d.dayofyear - 200) / 365.25 * 2 * np.pi)  # 1 in mid-July, -1 in mid-January
        temp = 11 + 8 * season + self.rng.normal(0, 2.5)
        sky = "sunny" if self.rng.random() < 0.35 + 0.15 * season else ("rain" if self.rng.random() < 0.5 else "cloudy")
        if self.weather_active.get("heat", -1) >= t:
            temp, sky = max(temp, 27 + self.rng.normal(2, 1.5)), "sunny"
        if self.weather_active.get("cold", -1) >= t:
            temp, sky = min(temp, -2 + self.rng.normal(0, 2)), "snow"
        if self.weather_active.get("storm", -1) >= t:
            sky = "storm"
        return {"temp": round(float(temp)), "sky": sky}

    def run(self) -> Simulation:
        weather = []
        for t in range(self.T):
            if t == self.reset_at:
                # The live world starts fresh: companies.yaml describes the bosses as of launch day,
                # and backstory storylines stop rather than spill into the published news.
                self.bosses = {c["id"]: c["boss"] for c in self.w.companies}
                self.pending = {}
                self.busy_until[:] = -1
                self.weather_active = {}
            self.maybe_start(t)  # first, so storylines starting today publish their opening stage today
            for inst, i in self.pending.pop(t, []):
                self.emit_stage(inst, i, t)
            if self.rng.random() < FEATURE_RATE and self.w.features:
                text = _fill(_pick(self.rng, self.w.features), self.people)
                self.news.append(News(len(self.news), t, text, "", "fluff", 0, "feature", -1, [], None, {}))
            weather.append(self.weather_for(t))
            self.boss_log.append(dict(self.bosses))
        return Simulation(self.w, self.cal, self.prices(), self.news, weather, self.boss_log)

    def prices(self) -> np.ndarray:
        rng, w, T, C = self.rng, self.w, self.T, self.C
        regime = np.empty(T)
        v = 1.0
        for t in range(T):  # calm and stormy spells for the whole market
            v = 1 + 0.94 * (v - 1) + rng.normal(0, 0.08)
            regime[t] = float(np.clip(v, 0.6, 2.2))
        market = rng.normal(0.00025, 0.008, T) * regime
        sector_moves = {s: rng.normal(0, 0.005, T) * regime for s in w.sectors}
        bars = np.empty((C, T, 4))
        for ci, c in enumerate(w.companies):
            sec = w.sectors[c["sector"]]
            vol = sec["vol"] * rng.uniform(0.75, 1.3)
            idio = rng.normal(0, vol, T) * regime
            overnight = 0.3 * idio + 0.2 * market * sec["beta"] + self.gap[ci, :T]
            intraday = 0.8 * idio + 0.8 * market * sec["beta"] + sector_moves[c["sector"]] + self.drift[ci, :T]
            close = rng.uniform(20, 400)
            for t in range(T):
                o = close * np.exp(overnight[t])
                cl = o * np.exp(intraday[t])
                wick = np.abs(rng.normal(0, 0.4, 2)) * vol * regime[t]
                bars[ci, t] = (o, max(o, cl) * np.exp(wick[0]), min(o, cl) * np.exp(-wick[1]), cl)
                close = cl
        return bars


def simulate(world: World, start: date | str, end: date | str, seed: int = 2026, launch: date | str | None = None) -> Simulation:
    """Simulate from ``start`` to ``end``. On ``launch`` the bosses reset to those in companies.yaml."""
    calendar = pd.bdate_range(pd.Timestamp(start), pd.Timestamp(end))
    reset = int(calendar.searchsorted(pd.Timestamp(launch))) if launch is not None else None
    return _Engine(world, calendar, seed, reset).run()
