import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { LoaderCircle } from 'lucide-react'

type LoadingProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'>

export const Loading = forwardRef<HTMLDivElement, LoadingProps>(function Loading(
  { className = '', ...props },
  ref
) {
  return (
    <div
      ref={ref}
      aria-label='Loading'
      role='status'
      className={`pointer-events-none absolute inset-0 flex items-center justify-center ${className}`}
      {...props}
    >
      <LoaderCircle
        aria-hidden='true'
        className='h-5 w-5 animate-spin text-app-text-muted'
        strokeWidth={1.8}
      />
    </div>
  )
})
