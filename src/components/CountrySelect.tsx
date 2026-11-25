'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { getAllCountries, type Country } from '@/lib/countries';

type Props = {
  value?: string; // cca2 코드
  onChange?: (country: Country) => void;
  placeholder?: string;
};

export default function CountrySelect({
  value,
  onChange,
  placeholder = '국가를 선택하세요',
}: Props) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAllCountries().then((data) => {
      setCountries(data);
      setLoading(false);
    });
  }, []);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = countries.find((c) => c.cca2 === value);

  const filtered = search
    ? countries.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase())
      )
    : countries;

  const handleSelect = (country: Country) => {
    onChange?.(country);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={ref} className="relative w-full">
      {/* 선택 버튼 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {selected ? (
          <>
            <Image
              src={selected.flagUrl}
              alt={selected.name}
              width={20}
              height={14}
              className="rounded-sm object-cover"
              unoptimized
            />
            <span className="flex-1 text-left">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-gray-400">{placeholder}</span>
        )}
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {/* 검색 */}
          <div className="p-2">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색..."
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 목록 */}
          <ul className="max-h-60 overflow-y-auto">
            {loading ? (
              <li className="px-3 py-2 text-sm text-gray-400">로딩 중...</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">검색 결과 없음</li>
            ) : (
              filtered.map((country) => (
                <li key={country.cca2}>
                  <button
                    type="button"
                    onClick={() => handleSelect(country)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 ${
                      country.cca2 === value ? 'bg-blue-50 font-medium text-blue-600' : ''
                    }`}
                  >
                    <Image
                      src={country.flagUrl}
                      alt={country.name}
                      width={20}
                      height={14}
                      className="rounded-sm object-cover"
                      unoptimized
                    />
                    <span>{country.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
