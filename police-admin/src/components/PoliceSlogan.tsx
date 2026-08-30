export const POLICE_SLOGAN = 'Silihawu Lembube Nesive';

interface PoliceSloganProps {
  className?: string;
}

export function PoliceSlogan({ className }: PoliceSloganProps) {
  return (
    <p className={className ? `topbar-slogan ${className}` : 'topbar-slogan'}>
      {POLICE_SLOGAN}
    </p>
  );
}
