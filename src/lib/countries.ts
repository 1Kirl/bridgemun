export type Country = {
  name: string;
  cca2: string;
  flagUrl: string;
};

/** 국기 이미지용 간소화 타입 (Firestore 저장용) */
export type CountryEntry = {
  name: string;
  code: string; // cca2 소문자
};

/** G7 고정 국가 목록 */
export const G7_COUNTRIES: CountryEntry[] = [
  { name: "United States", code: "us" },
  { name: "United Kingdom", code: "gb" },
  { name: "France", code: "fr" },
  { name: "Germany", code: "de" },
  { name: "Italy", code: "it" },
  { name: "Canada", code: "ca" },
  { name: "Japan", code: "jp" },
];

/** 전체 국가 목록 (restcountries API) */
let cache: Country[] | null = null;

/**
 * 내장 폴백 국가 목록. 외부 API(restcountries.com)가 막히거나 다운돼도
 * 앱이 동작하도록 주요 UN 회원국을 번들로 포함한다. 국기는 flagcdn 사용.
 */
const FALLBACK_CCA2: Array<[string, string]> = [
  ["Afghanistan", "AF"], ["Albania", "AL"], ["Algeria", "DZ"], ["Argentina", "AR"],
  ["Australia", "AU"], ["Austria", "AT"], ["Bangladesh", "BD"], ["Belgium", "BE"],
  ["Brazil", "BR"], ["Bulgaria", "BG"], ["Canada", "CA"], ["Chile", "CL"],
  ["China", "CN"], ["Colombia", "CO"], ["Croatia", "HR"], ["Cuba", "CU"],
  ["Czechia", "CZ"], ["Denmark", "DK"], ["Egypt", "EG"], ["Ethiopia", "ET"],
  ["Finland", "FI"], ["France", "FR"], ["Germany", "DE"], ["Greece", "GR"],
  ["Hungary", "HU"], ["Iceland", "IS"], ["India", "IN"], ["Indonesia", "ID"],
  ["Iran", "IR"], ["Iraq", "IQ"], ["Ireland", "IE"], ["Israel", "IL"],
  ["Italy", "IT"], ["Japan", "JP"], ["Jordan", "JO"], ["Kazakhstan", "KZ"],
  ["Kenya", "KE"], ["Kuwait", "KW"], ["Lebanon", "LB"], ["Libya", "LY"],
  ["Malaysia", "MY"], ["Mexico", "MX"], ["Morocco", "MA"], ["Netherlands", "NL"],
  ["New Zealand", "NZ"], ["Nigeria", "NG"], ["North Korea", "KP"], ["Norway", "NO"],
  ["Pakistan", "PK"], ["Peru", "PE"], ["Philippines", "PH"], ["Poland", "PL"],
  ["Portugal", "PT"], ["Qatar", "QA"], ["Romania", "RO"], ["Russia", "RU"],
  ["Saudi Arabia", "SA"], ["Singapore", "SG"], ["South Africa", "ZA"],
  ["South Korea", "KR"], ["Spain", "ES"], ["Sweden", "SE"], ["Switzerland", "CH"],
  ["Syria", "SY"], ["Thailand", "TH"], ["Turkey", "TR"], ["Ukraine", "UA"],
  ["United Arab Emirates", "AE"], ["United Kingdom", "GB"], ["United States", "US"],
  ["Venezuela", "VE"], ["Vietnam", "VN"],
];

function fallbackCountries(): Country[] {
  return FALLBACK_CCA2.map(([name, cca2]) => ({
    name,
    cca2,
    flagUrl: `https://flagcdn.com/${cca2.toLowerCase()}.svg`,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAllCountries(): Promise<Country[]> {
  if (cache) return cache;

  try {
    // 외부 API가 느리거나 응답 없을 때 무한 대기 방지 (8초 타임아웃)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://restcountries.com/v3.1/all?fields=name,cca2,flags',
      { signal: controller.signal, next: { revalidate: 86400 } },
    );
    clearTimeout(timer);

    if (!res.ok) throw new Error('Failed to fetch countries');

    const data = await res.json();

    cache = (data as any[])
      .map((c) => ({
        name: c.name.common as string,
        cca2: c.cca2 as string,
        flagUrl: c.flags.svg as string,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return cache;
  } catch (e) {
    // API 차단/다운 시 내장 목록으로 폴백 (앱이 멈추지 않도록)
    console.warn('countries API unavailable, using bundled fallback:', e);
    cache = fallbackCountries();
    return cache;
  }
}

/** 전체 국가 → CountryEntry 변환 후 랜덤으로 n개 선택 */
export async function getRandomCountries(n: number): Promise<CountryEntry[]> {
  const all = await getAllCountries();
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map((c) => ({
    name: c.name,
    code: c.cca2.toLowerCase(),
  }));
}

/** 전체 국가 → CountryEntry[] 변환 (검색/선택용) */
export async function getAllCountryEntries(): Promise<CountryEntry[]> {
  const all = await getAllCountries();
  return all.map((c) => ({
    name: c.name,
    code: c.cca2.toLowerCase(),
  }));
}
