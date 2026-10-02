import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { getJson, IntegrationError } from "./http";

// Open-Meteo (free, no key). Needs coordinates, so place names go through its geocoder first.

interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
}

interface Forecast {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: number[];
  };
}

// WMO weather codes
const CONDITIONS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "heavy freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

function describe(code: number): string {
  return CONDITIONS[code] ?? "unknown conditions";
}

// Geocoder matches on name only; text after the comma (country, region or code) picks between candidates.
export async function geocode(location: string): Promise<GeocodeResult> {
  const [name, qualifier] = location.split(",").map((part) => part.trim());

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", qualifier ? "10" : "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const data = await getJson<{ results?: GeocodeResult[] }>(url.toString(), {
    label: "Weather geocoder",
  });
  const candidates = data.results ?? [];

  const wanted = qualifier?.toLowerCase();
  const match = wanted
    ? candidates.find((candidate) =>
        [candidate.country, candidate.admin1, candidate.country_code]
          .filter(Boolean)
          .some((field) => field!.toLowerCase() === wanted),
      ) ?? candidates[0]
    : candidates[0];

  if (!match) {
    throw new IntegrationError(
      `Couldn't find a place called "${location}"`,
      undefined,
      "Try a nearby larger city, or add the country, e.g. \"Pune, India\".",
    );
  }
  return match;
}

export function placeLabel(place: GeocodeResult): string {
  return [place.name, place.admin1, place.country].filter(Boolean).join(", ");
}

const forecast = defineAction({
  app: "weather",
  action: "forecast",
  description:
    "Get current weather and today's forecast for a place. Returns a single forecast object, not a list — reference its fields directly, e.g. {{weather.today.rainChance}}. Use this for morning briefings, or to act only when it will rain, snow or get hot.",
  returns:
    "{ location, units, willRain, current: { temperature, feelsLike, condition, windSpeed, precipitation }, today: { high, low, condition, rainChance, rainTotal } } — willRain is true when today's rain chance is 50% or more",
  params: z.object({
    location: z
      .string()
      .min(1)
      .max(100)
      .describe('city name, optionally with country, e.g. "London" or "Pune, India"'),
    units: z.enum(["metric", "imperial"]).default("metric"),
  }),
  async run({ location, units }) {
    const place = await geocode(location);
    const imperial = units === "imperial";

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    );
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    );
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "1");
    if (imperial) {
      url.searchParams.set("temperature_unit", "fahrenheit");
      url.searchParams.set("wind_speed_unit", "mph");
      url.searchParams.set("precipitation_unit", "inch");
    }

    const data = await getJson<Forecast>(url.toString(), { label: "Weather" });
    const rainChance = data.daily.precipitation_probability_max[0] ?? 0;

    return {
      location: placeLabel(place),
      units: imperial
        ? { temperature: "°F", wind: "mph", precipitation: "in" }
        : { temperature: "°C", wind: "km/h", precipitation: "mm" },
      // Lets "only if it rains" compile to an eq check. rainChance is still there for other thresholds.
      willRain: rainChance >= 50,
      current: {
        temperature: data.current.temperature_2m,
        feelsLike: data.current.apparent_temperature,
        condition: describe(data.current.weather_code),
        windSpeed: data.current.wind_speed_10m,
        precipitation: data.current.precipitation,
      },
      today: {
        high: data.daily.temperature_2m_max[0],
        low: data.daily.temperature_2m_min[0],
        condition: describe(data.daily.weather_code[0]),
        rainChance,
        rainTotal: data.daily.precipitation_sum[0],
      },
    };
  },
});

export const weather = defineApp({
  key: "weather",
  label: "Weather",
  auth: "none",
  actions: [forecast],
});
