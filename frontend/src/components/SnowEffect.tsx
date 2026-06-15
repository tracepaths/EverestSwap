import { useEffect, useRef } from 'react';

export function SnowEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Local non-null context reference for TypeScript compiler safety
    const context = ctx;

    let animationId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Subtle/thin snow: limit max particles to 40 for a light/delicate feel
    const maxParticles = 40;
    const particles: Array<{
      x: number;
      y: number;
      r: number;
      d: number;
      speedY: number;
      speedX: number;
    }> = [];

    for (let i = 0; i < maxParticles; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.5 + 0.8, // thin flakes: 0.8px to 2.3px
        d: Math.random() * maxParticles,
        speedY: Math.random() * 0.8 + 0.4, // slow and peaceful falling speed
        speedX: Math.random() * 0.3 - 0.15, // gentle drift
      });
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255, 255, 255, 0.5)'; // soft semi-transparent white
      context.beginPath();
      for (let i = 0; i < maxParticles; i++) {
        const p = particles[i];
        context.moveTo(p.x, p.y);
        context.arc(p.x, p.y, p.r, 0, Math.PI * 2, true);

        // Update position
        p.y += p.speedY;
        p.x += p.speedX + Math.sin(p.d) * 0.08;

        // Reset particle if it falls off-screen
        if (p.y > height) {
          particles[i] = {
            x: Math.random() * width,
            y: -10,
            r: p.r,
            d: p.d,
            speedY: p.speedY,
            speedX: p.speedX,
          };
        }
        if (p.x > width) {
          p.x = 0;
        } else if (p.x < 0) {
          p.x = width;
        }
      }
      context.fill();
      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999, // render on top of all elements
      }}
    />
  );
}
