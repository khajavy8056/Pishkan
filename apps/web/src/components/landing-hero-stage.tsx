/**
 * Hero visual: a layered 3D composition, not one flat photo.
 *
 * The old hero was a single photograph with chips floating over it — one piece,
 * one plane. This is a *stage* with five independent objects at different
 * depths, each turning at its own rate against the pointer, plus a slow idle
 * float so the scene breathes when the mouse is still.
 *
 * The arrangement is a pinwheel so nothing collides and the building stays
 * readable in the middle:
 *
 *        seal ·············· ID card
 *        │       building      │
 *        │        photo        │
 *        dossier ··········· brand
 *
 * Every object is a separate transparent WebP (see `public/images/landing/`),
 * so the no-3D fallback is the same markup with the transforms switched off —
 * which is exactly what the mobile block in `styles.css` does.
 *
 * Pointer and scroll are published as tokens on the page root, so this whole
 * scene is CSS. React never re-renders while the mouse moves.
 */
import { useBrand, BrandMark } from '../lib/brand';

interface Piece {
  /** File name under /images/landing (WebP with a PNG fallback). */
  name: string;
  alt: string;
  /** translateZ depth in px. */
  z: number;
  /** How far this piece travels against the pointer, in px. */
  drift: number;
  /** Extra idle rotation so the pieces never sit in lockstep. */
  idle: number;
  className: string;
  /** Width utility; the intrinsic ratio comes from the image itself. */
  width: string;
  /** Staggered idle float phase. */
  delay: string;
}

const PIECES: Piece[] = [
  { name: 'seal', alt: 'مُهر تأیید کارشناس', z: 240, drift: 3.4, idle: -6, className: 'top-[9%] left-[4%]', width: 'w-[20%]', delay: '-2.2s' },
  { name: 'idcard', alt: 'کارت ملی', z: 190, drift: 2.7, idle: 4, className: 'top-[3%] -right-[2%]', width: 'w-[38%]', delay: '-4.6s' },
  { name: 'dossier', alt: 'پروندهٔ درخواست', z: 120, drift: 1.9, idle: -3, className: 'bottom-[2%] -left-[3%]', width: 'w-[42%]', delay: '-1.1s' },
];

export function HeroStage({ heroImage, className }: { heroImage: string; className?: string }) {
  const brand = useBrand();

  return (
    <div className={className}>
      <div className="hero-stage-wrap relative mx-auto w-full max-w-[34rem]">
        {/* soft floor glow, behind everything */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[12%] bottom-[-6%] h-24 rounded-[50%] bg-brand-500/25 blur-2xl"
        />

        {/* the stage: perspective host; every child lives in 3D */}
        <div className="hero-stage-v2 relative aspect-[5/4.6] w-full">
          {/* ---------- layer 1: the building, the backdrop ---------- */}
          <div className="hero-piece" data-piece="plate" style={{ ['--z' as string]: '-40px', ['--d' as string]: '0.8' }}>
            <div className="relative h-full overflow-hidden rounded-[2rem] shadow-2xl shadow-brand-950/40 ring-1 ring-white/25">
              <img
                src={heroImage}
                alt={`ساختمان ${brand.name}`}
                className="hero-plate size-full object-cover"
                fetchPriority="high"
                decoding="async"
              />
              {/* the scrim pulls the photo back so the objects read first */}
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-tl from-brand-950/70 via-brand-900/25 to-transparent" />
              <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(115%_85%_at_72%_8%,transparent,rgba(2,6,23,.5))]" />
              <span className="absolute inset-x-4 bottom-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-[10.5px] font-bold text-white/90 ring-1 ring-white/20 backdrop-blur">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {brand.tagline || 'سریع • مطمئن • آسان'}
              </span>
            </div>
          </div>

          {/* ---------- layers 2–4: the objects, one per corner ---------- */}
          {PIECES.map((piece) => (
            <div
              key={piece.name}
              className={`hero-piece absolute ${piece.className} ${piece.width}`}
              data-piece={piece.name}
              style={{
                ['--z' as string]: `${piece.z}px`,
                ['--d' as string]: String(piece.drift),
                ['--i' as string]: `${piece.idle}deg`,
                ['--delay' as string]: piece.delay,
              }}
            >
              <picture>
                <source srcSet={`/images/landing/${piece.name}.webp`} type="image/webp" />
                <img
                  src={`/images/landing/${piece.name}.png`}
                  alt={piece.alt}
                  className="hero-object w-full select-none drop-shadow-[0_22px_28px_rgba(2,6,23,0.45)]"
                  decoding="async"
                  draggable={false}
                />
              </picture>
            </div>
          ))}

          {/* ---------- layer 5: the office card, at the front ---------- */}
          <div
            className="hero-piece absolute right-[2%] bottom-[8%] w-[42%] max-w-[13rem]"
            data-piece="brand"
            style={{ ['--z' as string]: '320px', ['--d' as string]: '4.2', ['--i' as string]: '0deg', ['--delay' as string]: '-3.4s' }}
          >
            <div className="rounded-[1.6rem] bg-white/92 p-4 text-center shadow-2xl shadow-brand-950/50 ring-1 ring-white/70 backdrop-blur-md">
              <BrandMark className="mx-auto size-14" />
              <p className="mt-2.5 truncate text-[15px] font-black text-navy-950">{brand.name}</p>
              {brand.nameEn && (
                <p dir="ltr" className="truncate text-[10px] font-semibold tracking-wide text-navy-500">{brand.nameEn}</p>
              )}
              <div className="mt-2.5 flex items-center justify-center gap-1 rounded-full bg-emerald-50 py-1 text-[9.5px] font-bold text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                دفتر فعال
              </div>
            </div>
          </div>

          {/* ---------- ambient: rings lying on the floor ---------- */}
          <div aria-hidden="true" className="hero-orbit absolute inset-x-[6%] bottom-[-3%] h-32" />
          <div aria-hidden="true" className="hero-orbit absolute inset-x-[22%] bottom-[1%] h-24 opacity-45" style={{ animationDelay: '-4.5s' }} />
        </div>

        {/* legend: names the objects so the scene is legible, not just pretty */}
        <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
          {[
            { label: 'ثبت درخواست', tone: 'bg-brand-50 text-brand-700 ring-brand-200' },
            { label: 'بارگذاری مدارک', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
            { label: 'تأیید کارشناس', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
          ].map((chip, index) => (
            <span key={chip.label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ring-1 ${chip.tone}`}>
              <span className="grid size-4 place-items-center rounded-full bg-white/70 text-[9px]">{index + 1}</span>
              {chip.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
