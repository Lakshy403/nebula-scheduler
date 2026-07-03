import React from 'react';

export default function BackgroundWaves() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ backgroundColor: '#FDFBF7', zIndex: -1 }}>
      <svg className="absolute w-full h-full opacity-80" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="wave-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffedd5" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="wave-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fed7aa" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FDFBF7" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="line-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fb923c" stopOpacity="0.1" />
            <stop offset="50%" stopColor="#f97316" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#ea580c" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="line-grad-2" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fdba74" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#f97316" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Soft background sweeping fills to blend skin and orange */}
        <path d="M0,0 L1440,0 L1440,300 C1000,500 400,100 0,400 Z" fill="url(#wave-grad-1)" />
        <path d="M0,900 L1440,900 L1440,600 C900,800 500,450 0,700 Z" fill="url(#wave-grad-2)" />

        {/* Dynamic sweeping line shapes group 1 */}
        <path d="M-100,200 C300,500 800,0 1540,300" fill="none" stroke="url(#line-grad-1)" strokeWidth="3" />
        <path d="M-100,220 C320,520 780,20 1540,320" fill="none" stroke="url(#line-grad-1)" strokeWidth="2" opacity="0.7" />
        <path d="M-100,240 C340,540 760,40 1540,340" fill="none" stroke="url(#line-grad-1)" strokeWidth="1" opacity="0.4" />
        <path d="M-100,260 C360,560 740,60 1540,360" fill="none" stroke="url(#line-grad-1)" strokeWidth="0.5" opacity="0.2" />
        
        {/* Dynamic sweeping line shapes group 2 */}
        <path d="M-100,700 C400,900 900,400 1540,800" fill="none" stroke="url(#line-grad-2)" strokeWidth="3" />
        <path d="M-100,720 C380,920 920,420 1540,820" fill="none" stroke="url(#line-grad-2)" strokeWidth="2" opacity="0.7" />
        <path d="M-100,740 C360,940 940,440 1540,840" fill="none" stroke="url(#line-grad-2)" strokeWidth="1" opacity="0.4" />
        
        {/* Gentle intersecting curve */}
        <path d="M-100,500 C400,200 1000,800 1540,400" fill="none" stroke="url(#line-grad-1)" strokeWidth="1.5" opacity="0.5" />
      </svg>
    </div>
  );
}
