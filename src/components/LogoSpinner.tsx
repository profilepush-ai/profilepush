import { ScoreLine } from './brand/BrandLoader';

interface LogoSpinnerProps {
  size?: number;
}

/**
 * The small loader used in place of spinners: a short match score line
 * filling a step at a time (see brand/BrandLoader).
 */
export default function LogoSpinner({ size = 16 }: LogoSpinnerProps) {
  return <ScoreLine width={Math.round(size * 2)} thickness={Math.max(3, Math.round(size / 4))} />;
}
