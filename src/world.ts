// Loads the published world (backtester/world/publish.py writes these files).

export interface CompanyRef {
  id: string;
  name: string;
}

export interface Story {
  headline: string;
  body: string;
  tag: string;
  companies: CompanyRef[];
}

export interface Mover extends CompanyRef {
  ticker: string;
  change: number;
}

export interface Edition {
  date: string;
  edition: number;
  weather: { temp: number; sky: "sunny" | "cloudy" | "rain" | "snow" | "storm"; forecast: string; presenter: string };
  developing: (Story & { since: string })[];
  gossip: string[];
  spotlight: {
    id: string; name: string; ticker: string; what: string; product: string; boss: string; trait: string;
    district: string; price: number; month: number; spark: number[];
  };
  lead: Story | null;
  stories: Story[];
  briefs: string[];
  features: string[];
  markets: { index: number; change: number; gainers: Mover[]; losers: Mover[] };
}

export interface CompanySummary {
  id: string;
  name: string;
  ticker: string;
  sector: string;
  price: number;
  change: number;
  spark: number[];
}

export interface WorldIndex {
  city: string;
  newspaper: string;
  motto: string;
  blurb: string;
  index_name: string;
  launch: string;
  today: string; // date of the latest edition
  completed: string; // latest trading day whose close is published
  editions: string[];
  sectors: string[];
  districts: { name: string; blurb: string }[];
  characters: { name: string; about: string }[];
  companies: CompanySummary[];
  index_series: { dates: string[]; levels: number[] };
  prices: { dates: string[]; index: number[]; closes: Record<string, number[]> }; // since the start of last month
}

export interface CompanyPage {
  id: string;
  name: string;
  ticker: string;
  what: string;
  product: string;
  sector: string;
  district: string;
  boss: string;
  trait: string;
  rival: string | null;
  rival_id: string | null;
  launch_index: number;
  dates: string[];
  closes: number[];
  news: { date: string; headline: string }[];
}

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${base}world/${path}`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${path}`);
      return res.json();
    }).catch((e) => {
      cache.delete(path);
      throw e;
    }));
  }
  return cache.get(path) as Promise<T>;
}

export const loadWorld = () => get<WorldIndex>("index.json");
export const loadEdition = (date: string) => get<Edition>(`days/${date}.json`);
export const loadCompany = (id: string) => get<CompanyPage>(`companies/${id}.json`);

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const SKY_ICON: Record<Edition["weather"]["sky"], string> = {
  sunny: "☀️", cloudy: "☁️", rain: "🌧️", snow: "❄️", storm: "⛈️",
};
