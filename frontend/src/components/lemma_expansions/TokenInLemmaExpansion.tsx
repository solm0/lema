import type { Token } from "../pageTypes";
import { getLookupKey, getLookupKeyForMorph } from "../tokenLookup";

export function TokenInLemmaExpansion({
  token,
  onSelect,
  language,
  isCenter = false,
  className = "",
  inheritTextColor = false,
  canSelectKey,
  lemmaInfo,
  interestKeys,
  excludedInterestKey,
}:{
  token: Token;
  onSelect?: (tokenKey: string) => void;
  language: string;
  isCenter?: boolean
  className?: string;
  inheritTextColor?: boolean;
  canSelectKey?: (tokenKey: string) => boolean;
  lemmaInfo?: Record<string, { is_interested?: boolean }>;
  interestKeys?: Set<string>;
  excludedInterestKey?: string;
}) {
  const lookupKey = getLookupKey(token, language);
  const tokenSelectable = lookupKey != null && (canSelectKey ? canSelectKey(lookupKey) : true);
  const isMutedToken = !tokenSelectable;

  const isInterested = (key: string | null) => {
    if (!key || key === excludedInterestKey) return false;
    const parts = key.split("_");
    const pos = parts.pop();
    const lemma = parts.join("_");
    const globalKey = lemma && pos ? `${lemma}/${pos}/${language}` : null;
    return Boolean(
      (globalKey && interestKeys?.has(globalKey)) ||
      lemmaInfo?.[key]?.is_interested === true
    );
  };

  const renderSurface = (surface: string, key: string | null) => {
    const interested = isInterested(key);
    return (
      <span
        className={`relative isolate inline-block ${
          interested ? "bg-yellow-200/50" : ""
        }`}
      >
        {interested && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-0.5 bg-yellow-400/30"
          />
        )}
        <span className="relative z-10">{surface}</span>
      </span>
    );
  };

  if ((language === "ko" || language === "ja") && token.morphs && token.morphs.length > 0) {
    return (
      <span className={className}>
        {token.morphs.map((morph, index) => {
          const morphKey = getLookupKeyForMorph(morph, language);
          const morphSelectable = morphKey != null && (canSelectKey ? canSelectKey(morphKey) : true);

          return (
            <span
              key={`${morph.surface}-${index}`}
              onClick={() => {
                if (!morphSelectable || !morphKey || !onSelect || isCenter) return;
                onSelect(morphKey);
              }}
              className={`
                transition-all
                ${isCenter ? 'cursor-default' : morphSelectable ? 'cursor-pointer' : 'cursor-default'}
                ${morphSelectable ? (inheritTextColor ? 'text-inherit' : 'text-neutral-700') : 'text-neutral-400 pointer-events-none'}
              `}
            >
              {renderSurface(morph.surface, morphKey)}
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <span
      onClick={() => {
        if (!tokenSelectable || !lookupKey || !onSelect || isCenter) return;
        onSelect(lookupKey);
      }}
      className={`
        transition-all
        ${isCenter ? 'cursor-default' : tokenSelectable ? 'cursor-pointer' : 'cursor-default'}
        ${isMutedToken ? 'text-neutral-400 pointer-events-none' : inheritTextColor ? 'text-inherit' : 'text-neutral-600'}
        ${className}
      `}
    >
      {renderSurface(token.surface, lookupKey)}
    </span>
  )
}
