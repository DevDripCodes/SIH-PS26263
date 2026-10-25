import {
  memo,
  type ReactNode,
  useState,
  type ChangeEvent,
  type FormEvent,
  forwardRef,
} from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

// Helper image component for React / Vite
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

// ==================== Input Component ====================

const Input = memo(
  forwardRef(function Input(
    { className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>,
    ref: React.ForwardedRef<HTMLInputElement>
  ) {
    return (
      <div className='relative w-full'>
        <input
          type={type}
          className={cn(
            'flex h-11 w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800/90 px-3.5 py-2 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:ring-blue-500/30 dark:focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  })
);

Input.displayName = 'Input';

// ==================== BoxReveal Component ====================

type BoxRevealProps = {
  children: ReactNode;
  width?: string;
  boxColor?: string;
  duration?: number;
  overflow?: string;
  position?: string;
  className?: string;
};

const BoxReveal = memo(function BoxReveal({
  children,
  width = 'fit-content',
  duration = 0.35,
  className,
}: BoxRevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: 'easeOut' }}
      style={{ width }}
      className={className}
    >
      {children}
    </motion.div>
  );
});

// ==================== Ripple Component ====================

type RippleProps = {
  mainCircleSize?: number;
  mainCircleOpacity?: number;
  numCircles?: number;
  className?: string;
};

const Ripple = memo(function Ripple({
  mainCircleSize = 140,
  mainCircleOpacity = 0.28,
  numCircles = 8,
  className = '',
}: RippleProps) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none ${className}`}
    >
      {Array.from({ length: numCircles }, (_, i) => {
        const size = mainCircleSize + i * 80;
        const opacity = Math.max(0.04, mainCircleOpacity - i * 0.03);
        const animationDelay = `${i * 0.08}s`;
        const borderStyle = i === numCircles - 1 ? 'dashed' : 'solid';

        return (
          <span
            key={i}
            className='absolute rounded-full border border-neutral-300/70 dark:border-neutral-700/50 pointer-events-none animate-ripple'
            style={{
              width: `${size}px`,
              height: `${size}px`,
              opacity: opacity,
              animationDelay: animationDelay,
              borderStyle: borderStyle,
              borderWidth: '1px',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        );
      })}
    </div>
  );
});

// ==================== OrbitingCircles Component ====================

type OrbitingCirclesProps = {
  className?: string;
  children: ReactNode;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
};

const OrbitingCircles = memo(function OrbitingCircles({
  className,
  children,
  reverse = false,
  duration = 20,
  delay = 10,
  radius = 50,
  path = true,
}: OrbitingCirclesProps) {
  return (
    <>
      {path && (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          version='1.1'
          className='pointer-events-none absolute inset-0 size-full'
        >
          <circle
            className='stroke-neutral-300/50 dark:stroke-neutral-700/40 stroke-1'
            cx='50%'
            cy='50%'
            r={radius}
            fill='none'
          />
        </svg>
      )}
      <div
        style={
          {
            top: '50%',
            left: '50%',
            '--duration': duration,
            '--radius': radius,
            '--delay': -delay,
          } as React.CSSProperties
        }
        className={cn(
          'absolute flex items-center justify-center rounded-full pointer-events-none animate-orbit',
          { '[animation-direction:reverse]': reverse },
          className
        )}
      >
        {children}
      </div>
    </>
  );
});

// ==================== TechOrbitDisplay Component ====================

type IconConfig = {
  className?: string;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  reverse?: boolean;
  component: () => React.ReactNode;
};

type TechnologyOrbitDisplayProps = {
  iconsArray: IconConfig[];
  text?: string;
};

const TechOrbitDisplay = memo(function TechOrbitDisplay({
  iconsArray,
  text = 'APAAR Portal',
}: TechnologyOrbitDisplayProps) {
  return (
    <div className='relative flex h-full w-full flex-col items-center justify-center overflow-hidden'>
      {/* Central Title */}
      <span className='pointer-events-none select-none text-center text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight bg-gradient-to-b from-neutral-900 via-neutral-800 to-neutral-500 dark:from-white dark:via-neutral-200 dark:to-neutral-500 bg-clip-text text-transparent z-10'>
        {text}
      </span>

      {/* Orbiting Icons */}
      <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
        {iconsArray.map((icon, index) => (
          <OrbitingCircles
            key={index}
            className={icon.className}
            duration={icon.duration}
            delay={icon.delay}
            radius={icon.radius}
            path={icon.path}
            reverse={icon.reverse}
          >
            {icon.component()}
          </OrbitingCircles>
        ))}
      </div>
    </div>
  );
});

// ==================== AnimatedForm Component ====================

type FieldType = 'text' | 'email' | 'password';

type Errors = {
  [key: string]: string;
};

type AnimatedFormProps = {
  header: string;
  subHeader?: string;
  fields: Array<{
    label: string;
    required?: boolean;
    type: FieldType;
    placeholder: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  }>;
  submitButton: string;
  textVariantButton?: string;
  errorField?: string;
  fieldPerRow?: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  googleLogin?: string;
  goTo?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

const AnimatedForm = memo(function AnimatedForm({
  header,
  subHeader,
  fields,
  submitButton,
  textVariantButton,
  errorField,
  onSubmit,
  googleLogin,
  goTo,
}: AnimatedFormProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const [errors, setErrors] = useState<Errors>({});

  const toggleVisibility = () => setVisible(!visible);

  const validateForm = (event: FormEvent<HTMLFormElement>) => {
    const currentErrors: Errors = {};
    fields.forEach((field) => {
      const value = (event.target as HTMLFormElement)[field.label]?.value;

      if (field.required && !value) {
        currentErrors[field.label] = `${field.label} is required`;
      }

      if (field.type === 'email' && value && !/\S+@\S+\.\S+/.test(value)) {
        currentErrors[field.label] = 'Invalid email address';
      }

      if (field.type === 'password' && value && value.length < 6) {
        currentErrors[field.label] =
          'Password must be at least 6 characters long';
      }
    });
    return currentErrors;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formErrors = validateForm(event);

    if (Object.keys(formErrors).length === 0) {
      onSubmit(event);
    } else {
      setErrors(formErrors);
    }
  };

  return (
    <div className='w-full max-w-sm mx-auto flex flex-col gap-4'>
      <BoxReveal duration={0.3}>
        <h2 className='font-bold text-3xl tracking-tight text-neutral-900 dark:text-white'>
          {header}
        </h2>
      </BoxReveal>

      {subHeader && (
        <BoxReveal duration={0.3} className='pb-1'>
          <p className='text-neutral-500 dark:text-neutral-400 text-sm'>
            {subHeader}
          </p>
        </BoxReveal>
      )}

      {googleLogin && (
        <>
          <BoxReveal duration={0.3} width='100%'>
            <button
              className='flex items-center justify-center w-full h-11 gap-3 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800/90 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 font-medium text-sm transition shadow-xs cursor-pointer'
              type='button'
              onClick={() => console.log('Google login clicked')}
            >
              <Image
                src='https://cdn.21st.dev/assets/mirror/89/8948eafec4a9c68b2b3a78a756b4474c05e53431f208149556fb669e3c429be2.png'
                width={20}
                height={20}
                alt='Google'
              />
              {googleLogin}
            </button>
          </BoxReveal>

          <BoxReveal duration={0.3} width='100%'>
            <div className='flex items-center gap-3 py-1'>
              <hr className='flex-1 border-neutral-200 dark:border-neutral-800' />
              <span className='text-xs uppercase tracking-wider text-neutral-400 font-medium'>
                or
              </span>
              <hr className='flex-1 border-neutral-200 dark:border-neutral-800' />
            </div>
          </BoxReveal>
        </>
      )}

      <form onSubmit={handleSubmit} className='space-y-4'>
        <div className='flex flex-col gap-3.5'>
          {fields.map((field) => (
            <div key={field.label} className='flex flex-col gap-1.5'>
              <Label htmlFor={field.label} className='text-xs font-semibold text-neutral-700 dark:text-neutral-300'>
                {field.label} {field.required && <span className='text-red-500'>*</span>}
              </Label>

              <div className='relative'>
                <Input
                  type={
                    field.type === 'password'
                      ? visible
                        ? 'text'
                        : 'password'
                      : field.type
                  }
                  id={field.label}
                  placeholder={field.placeholder}
                  onChange={field.onChange}
                />

                {field.type === 'password' && (
                  <button
                    type='button'
                    onClick={toggleVisibility}
                    className='absolute inset-y-0 right-0 pr-3.5 flex items-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer'
                  >
                    {visible ? (
                      <Eye className='size-4' />
                    ) : (
                      <EyeOff className='size-4' />
                    )}
                  </button>
                )}
              </div>

              {errors[field.label] && (
                <p className='text-red-500 text-xs mt-0.5'>
                  {errors[field.label]}
                </p>
              )}
            </div>
          ))}
        </div>

        {errorField && (
          <p className='text-red-500 text-xs'>{errorField}</p>
        )}

        <button
          className='w-full h-11 rounded-xl bg-neutral-900 hover:bg-black dark:bg-blue-600 dark:hover:bg-blue-700 text-white font-semibold text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2'
          type='submit'
        >
          <span>{submitButton}</span>
          <span>&rarr;</span>
        </button>

        {textVariantButton && goTo && (
          <div className='text-center pt-2'>
            <button
              type='button'
              className='text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'
              onClick={goTo}
            >
              {textVariantButton}
            </button>
          </div>
        )}
      </form>
    </div>
  );
});

const BottomGradient = () => null;

// ==================== AuthTabs Component ====================

interface AuthTabsProps {
  formFields: {
    header: string;
    subHeader?: string;
    fields: Array<{
      label: string;
      required?: boolean;
      type: FieldType;
      placeholder: string;
      onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    }>;
    submitButton: string;
    textVariantButton?: string;
  };
  goTo: (event: React.MouseEvent<HTMLButtonElement>) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  googleLogin?: string;
}

const AuthTabs = memo(function AuthTabs({
  formFields,
  goTo,
  handleSubmit,
  googleLogin = 'Login with Google',
}: AuthTabsProps) {
  return (
    <div className='w-full max-w-sm mx-auto'>
      <AnimatedForm
        {...formFields}
        fieldPerRow={1}
        onSubmit={handleSubmit}
        goTo={goTo}
        googleLogin={googleLogin}
      />
    </div>
  );
});

// ==================== Label Component ====================

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  htmlFor?: string;
}

const Label = memo(function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    />
  );
});

// ==================== Exports ====================

export {
  Input,
  BoxReveal,
  Ripple,
  OrbitingCircles,
  TechOrbitDisplay,
  AnimatedForm,
  AuthTabs,
  Label,
  BottomGradient,
};
