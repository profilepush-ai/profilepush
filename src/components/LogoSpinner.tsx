import { LoaderMark } from './brand/BrandLoader';

interface LogoSpinnerProps {
  size?: number;
}

/**
 * The small brand loader used in place of spinners: the two dots click
 * together, then the chevron pushes along a short score line (see
 * brand/BrandLoader).
 */
export default function LogoSpinner({ size = 16 }: LogoSpinnerProps) {
  return <LoaderMark small height={size} />;
}
