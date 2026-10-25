import { Ripple, TechOrbitDisplay } from '@/components/ui/modern-animated-sign-in';
import type { OrbitIcon } from './types';

const Image = ({
  src,
  alt = '',
  width,
  height,
  className,
}: {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
}) => <img src={src} alt={alt} width={width} height={height} className={className} />;

const iconsArray: OrbitIcon[] = [
  // Ring 1 (Radius 100, opposite sides: ~60° and ~240°)
  {
    component: () => (
      <Image
        width={32}
        height={32}
        src='https://cdn.21st.dev/assets/mirror/34/34826e5b3315daadf4fa15f723a3c1d5ba4a89277bfd94e22ac4d7d3d54338c5.svg'
        alt='HTML5'
        className='size-[30px] select-none pointer-events-none'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 3.33,
    radius: 100,
    path: true,
    reverse: false,
  },
  {
    component: () => (
      <Image
        width={32}
        height={32}
        src='https://cdn.21st.dev/assets/mirror/36/36b7d94b657d571d3f94042acbf6a4c86a5301a222f83f4b4583ad2acf6e297d.svg'
        alt='CSS3'
        className='size-[30px] select-none pointer-events-none'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 13.33,
    radius: 100,
    path: false,
    reverse: false,
  },

  // Ring 2 (Radius 150, reverse: true, opposite sides: ~300° and ~135°)
  {
    component: () => (
      <Image
        width={32}
        height={32}
        src='https://cdn.21st.dev/assets/mirror/f8/f8cec54589553807eb603bcaf4e056aa090196211698b056542e3cc62a2f3448.svg'
        alt='TailwindCSS'
        className='size-[30px] select-none pointer-events-none'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 3.33,
    radius: 150,
    path: true,
    reverse: true,
  },
  {
    component: () => (
      <Image
        width={32}
        height={32}
        src='https://cdn.21st.dev/assets/mirror/d9/d9435c4ede7133b376c0173a80226bb3856729366707cd96e9a66e39448d0288.svg'
        alt='Nextjs'
        className='size-[30px] select-none pointer-events-none'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 12.5,
    radius: 150,
    path: false,
    reverse: true,
  },

  // Ring 3 (Radius 210, opposite sides: ~30° and ~210°)
  {
    component: () => (
      <Image
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/06/0656ff65fc8eeacda5c78d7f9ffe91ec1eb919db64f56e0b7dcd460af4bbd36c.svg'
        alt='JavaScript'
        className='size-[50px] select-none pointer-events-none'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 210,
    duration: 20,
    delay: 1.67,
    path: true,
    reverse: false,
  },
  {
    component: () => (
      <Image
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/c9/c9191199f4049920c2fc19035b8a6664f37f4689fcd9e8434e786097e78863f0.svg'
        alt='TypeScript'
        className='size-[50px] select-none pointer-events-none'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 210,
    duration: 20,
    delay: 11.67,
    path: false,
    reverse: false,
  },

  // Ring 4 (Radius 270, reverse: true, ~270° and ~125°)
  {
    component: () => (
      <Image
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/d3/d37c2bf1a1d4f10aeffb224e44da672cb8b9510f6e5a2e24b61758262995805e.svg'
        alt='Figma'
        className='size-[50px] select-none pointer-events-none'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 270,
    duration: 20,
    delay: 5.0,
    path: true,
    reverse: true,
  },
  {
    component: () => (
      <Image
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/58/5825b649c8c04dec13ecf01d0182401bd0ec71789d2fa06224866d882cd1515f.svg'
        alt='React'
        className='size-[50px] select-none pointer-events-none'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 270,
    duration: 20,
    delay: 13.0,
    path: false,
    reverse: true,
  },

  // Ring 5 (Radius 320, ~45°)
  {
    component: () => (
      <Image
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/71/717a57ea97bf7e86de721dab3e68afac66332a10676d5c9abce4ae6a5a9c9983.svg'
        alt='Git'
        className='size-[50px] select-none pointer-events-none'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 320,
    duration: 20,
    delay: 2.5,
    path: true,
    reverse: false,
  },
];

interface TechOrbitHeroProps {
  text?: string;
}

export function TechOrbitHero({ text = 'Animated Login' }: TechOrbitHeroProps) {
  return (
    <div className='flex flex-col justify-center w-1/2 max-lg:hidden relative overflow-hidden bg-neutral-50 dark:bg-[#030712] border-r border-neutral-200 dark:border-neutral-800/60 select-none'>
      <Ripple mainCircleSize={100} />
      <TechOrbitDisplay iconsArray={iconsArray} text={text} />
    </div>
  );
}
