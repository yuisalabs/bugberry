"use client"

import { RiAttachment2, RiCameraLine, RiFolderLine } from "@remixicon/react"
import {
  FileTrigger as FileTriggerPrimitive,
  type FileTriggerProps as FileTriggerPrimitiveProps,
} from "react-aria-components/FileTrigger"
import type { VariantProps } from "tailwind-variants"
import { Button, type buttonStyles } from "./button"
import { Loader } from "./loader"

export interface FileTriggerProps
  extends FileTriggerPrimitiveProps, VariantProps<typeof buttonStyles> {
  isDisabled?: boolean
  isPending?: boolean
  ref?: React.RefObject<HTMLInputElement>
  className?: string
  /** Shown in place of the default paperclip (camera, folder) icon. */
  icon?: React.ReactNode
}

export function FileTrigger({
  intent = "outline",
  size = "md",
  isCircle = false,
  ref,
  className,
  icon,
  ...props
}: FileTriggerProps) {
  return (
    <FileTriggerPrimitive ref={ref} {...props}>
      <Button
        className={className}
        isDisabled={props.isDisabled}
        intent={intent}
        size={size}
        isCircle={isCircle}
      >
        {!props.isPending ? (
          icon ?? (props.defaultCamera ? (
            <RiCameraLine />
          ) : props.acceptDirectory ? (
            <RiFolderLine />
          ) : (
            <RiAttachment2 />
          ))
        ) : (
          <Loader />
        )}
        {props.children ? (
          props.children
        ) : (
          <>
            {props.allowsMultiple
              ? "Browse a files"
              : props.acceptDirectory
                ? "Browse"
                : "Browse a file"}
            ...
          </>
        )}
      </Button>
    </FileTriggerPrimitive>
  )
}
