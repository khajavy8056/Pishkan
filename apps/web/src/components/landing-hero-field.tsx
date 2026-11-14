/**
 * Hero scene: a real 3D depth field, not a parallax backdrop.
 *
 * Points are projected by hand (`x/z`, `y/z`) onto a 2D canvas and drawn with
 * size and alpha derived from their depth, so near particles visibly rush past
 * while far ones drift. The whole field is gently steered by the pointer and by
 * scroll, which gives the "3D" reading that a flat mouse-tilt cannot.
 *
 * Why canvas rather than 300 divs: 300 transformed layers cost the compositor
 * 300 layers to manage, and on a mid-range Android that is a standing 30fps tax.
 * One canvas is a single layer, and the loop stops completely once the hero
 * scrolls out of view.
 *
 * Everything degrades: reduced motion draws one static frame; a failed canvas
 * context leaves the CSS gradient behind it untouched.
 */
import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  z: number;
  /** Depth-independent radius in world units. */
  r: number;
  hue: number;
  /** Vertical drift speed, so the field breathes even without input. */
  drift: number;
}

export function HeroField({
  className,
  /** 0 = near-black backdrop, 1 = bright daylight backdrop. */
  lightness = 0.5,
  density = 1,
  reducedMotion = false,
}: {
  className?: string;
  lightness?: number;
  density?: number;
  reducedMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const scroll = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let particles: Particle[] = [];
    let frame = 0;
    let running = true;
    let visible = true;
    let elapsed = 0;

    const build = () => {
      const count = Math.round(Math.min(190, Math.max(60, (width * height) / 14000)) * density);
      particles = Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 3.4,
        y: (Math.random() - 0.5) * 2.4,
        z: 0.35 + Math.random() * 2.6,
        r: 0.006 + Math.random() * 0.016,
        hue: 196 + Math.random() * 56,
        drift: (Math.random() - 0.5) * 0.00022,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      // Cap DPR: a 3x phone gains nothing visible here and pays 2.25x the fill.
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    const draw = () => {
      frame = 0;
      if (!running || !visible) return;
      elapsed += 1;

      pointer.current.x += (pointer.current.tx - pointer.current.x) * 0.06;
      pointer.current.y += (pointer.current.ty - pointer.current.y) * 0.06;

      context.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const focal = Math.min(width, height) * 0.95;
      // Pointer and scroll both push the camera, so the field reacts to either.
      const yaw = pointer.current.x * 0.5;
      const pitch = -pointer.current.y * 0.35 + scroll.current * 0.55;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);

      for (const particle of particles) {
        particle.y += particle.drift * 16;
        if (particle.y > 1.5) particle.y = -1.5;
        if (particle.y < -1.5) particle.y = 1.5;

        // Rotate around Y then X, then project.
        const x1 = particle.x * cosYaw - particle.z * sinYaw;
        const z1 = particle.x * sinYaw + particle.z * cosYaw;
        const y1 = particle.y * cosPitch - z1 * sinPitch;
        const z2 = particle.y * sinPitch + z1 * cosPitch;
        if (z2 <= 0.08) continue;

        const scale = focal / z2;
        const sx = cx + x1 * scale;
        const sy = cy + y1 * scale;
        if (sx < -60 || sx > width + 60 || sy < -60 || sy > height + 60) continue;

        const radius = Math.max(0.6, particle.r * scale);
        // Nearer points are brighter and more opaque; distance fades them out.
        const depth = Math.min(1, 1.25 / z2);
        const alpha = Math.min(0.92, 0.1 + depth * 0.68);
        const light = lightness;
        const sat = 74 - light * 12;
        const luminosity = 42 + light * 30;

        context.beginPath();
        context.arc(sx, sy, radius, 0, Math.PI * 2);
        context.fillStyle = `hsla(${particle.hue}, ${sat}%, ${luminosity}%, ${alpha * 0.9})`;
        context.fill();

        // A soft halo on the nearest points only: a cheap bloom that keeps the
        // far field crisp instead of muddy.
        if (radius > 3.2) {
          context.beginPath();
          context.arc(sx, sy, radius * 2.6, 0, Math.PI * 2);
          context.fillStyle = `hsla(${particle.hue}, ${sat}%, ${luminosity + 12}%, ${alpha * 0.1})`;
          context.fill();
        }
      }

      // Connect the closest few points into a constellation; this is what turns
      // "floating dots" into something that reads as a structure in space.
      const linkable = particles.slice(0, 46);
      for (let i = 0; i < linkable.length; i += 1) {
        for (let j = i + 1; j < linkable.length; j += 1) {
          const a = linkable[i];
          const b = linkable[j];
          const az = (a.x * sinYaw + a.z * cosYaw);
          const bz = (b.x * sinYaw + b.z * cosYaw);
          if (az <= 0.08 || bz <= 0.08) continue;
          const ax = cx + (a.x * cosYaw - a.z * sinYaw) * (focal / az);
          const ay = cy + (a.y * cosPitch - az * sinPitch) * (focal / az);
          const bx = cx + (b.x * cosYaw - b.z * sinYaw) * (focal / bz);
          const by = cy + (b.y * cosPitch - bz * sinPitch) * (focal / bz);
          const distance = Math.hypot(ax - bx, ay - by);
          if (distance > 120 || distance < 1) continue;
          const strength = (1 - distance / 120) * 0.16;
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.strokeStyle = `hsla(210, 80%, ${50 + lightness * 20}%, ${strength})`;
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (reducedMotion) {
        draw();
        running = false;
        return;
      }
      running = true;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
    };

    const onPointer = (event: PointerEvent) => {
      pointer.current.tx = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.current.ty = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    const onScroll = () => {
      const rect = canvas.getBoundingClientRect();
      scroll.current = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
    };

    resize();
    onScroll();
    start();

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas);

    // Stop the loop entirely when the hero is off-screen: a background tab or a
    // visitor reading the footer must not keep a phone's GPU awake.
    const intersection = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) start(); else stop();
      }, { threshold: 0.01 })
      : null;
    intersection?.observe(canvas);

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      stop();
      resizeObserver?.disconnect();
      intersection?.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [lightness, density, reducedMotion]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
