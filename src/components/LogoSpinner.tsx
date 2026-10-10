import { LoaderMark } from './brand/BrandLoader';

interface LogoSpinnerProps {
  size?: number;
}

/**
 * The small brand loader used in place of spinners: the logo's two dots
 * click together, then its chevron pushes forward (see brand/BrandLoader).
 */
export default function LogoSpinner({ size = 16 }: LogoSpinnerProps) {
  return <LoaderMark height={size} />;
}
