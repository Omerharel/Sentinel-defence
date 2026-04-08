'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer data-[state=checked]:bg-[#0BC5B3] data-[state=unchecked]:bg-[#D2D5DA] focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-[24px] w-[40px] shrink-0 items-center rounded-full border border-transparent outline-none transition-colors focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          'pointer-events-none block size-[16px] rounded-full bg-[#FFFFFF] shadow-[0_2px_4px_0_rgba(39,39,39,0.1)] ring-0 transition-transform duration-200 ease-out data-[state=checked]:translate-x-[20px] data-[state=unchecked]:translate-x-[4px]'
        }
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
