'use client';

import React, { useEffect, useMemo, useState } from 'react';

/** Shipping Publications / ship-info.com photo keyed by IMO. */
export function shipInfoPhotoUrl(imo: string | null | undefined): string | null {
  const id = String(imo ?? '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(id)) return null;
  return `https://www.ship-info.com/vessels/${id}.jpg`;
}

export function shipInfoPageUrl(imo: string | null | undefined): string | null {
  const id = String(imo ?? '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(id)) return null;
  return `https://www.ship-info.com/prog/ship.asp?id=${id}`;
}

type Props = {
  imo?: string | null;
  /**
   * Optional scripts-runner base for `/api/ship-photo/:imo`.
   * Tried first; falls back to the public ship-info.com URL.
   */
  proxyBase?: string | null;
  vesselName?: string | null;
  className?: string;
};

/**
 * Vessel photo from ship-info.com when an IMO is known.
 * Shows a source link even if the image is unavailable.
 */
export default function ShipPhoto({
  imo,
  proxyBase,
  vesselName,
  className = '',
}: Props) {
  const direct = shipInfoPhotoUrl(imo);
  const page = shipInfoPageUrl(imo);
  const id = String(imo ?? '').replace(/\D/g, '');
  const proxied =
    direct && proxyBase
      ? `${String(proxyBase).replace(/\/$/, '')}/api/ship-photo/${id}`
      : null;

  const candidates = useMemo(
    () => [proxied, direct].filter((u): u is string => Boolean(u)),
    [proxied, direct]
  );

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = candidates[index] || null;
  const exhausted = !src;

  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [candidates.join('|')]);

  if (!page && !direct) return null;

  return (
    <figure className={`ship-photo ${className}`.trim()}>
      {!exhausted && (
        <img
          key={src}
          src={src!}
          alt={vesselName ? `Photo of ${vesselName}` : 'Vessel photo'}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ display: loaded ? 'block' : 'none' }}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setIndex((i) => i + 1);
          }}
        />
      )}
      <figcaption>
        {loaded ? 'Photo via ' : 'Ship profile: '}
        {page ? (
          <a href={page} target="_blank" rel="noopener noreferrer">
            ship-info.com
          </a>
        ) : (
          'ship-info.com'
        )}
      </figcaption>
    </figure>
  );
}
