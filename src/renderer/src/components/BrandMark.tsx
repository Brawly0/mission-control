import mark from '../art/app-mark.webp'

export default function BrandMark({ size = 34 }: { size?: number }) {
  return <img className="brand-logo" src={mark} width={size} height={size} alt="Mission Control" draggable={false} />
}
