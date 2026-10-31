import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";

const ToastProvider = ToastPrimitive.Provider;

const ToastViewport = forwardRef<
  ElementRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className = "", ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={`z-50 m-0 flex max-h-screen list-none flex-col-reverse outline-none ${className}`}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

const Toast = forwardRef<
  ElementRef<typeof ToastPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>(({ className = "", ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={`toast-root relative flex w-[35ch] flex-col gap-1 rounded-lg border p-3 shadow-md data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] ${className}`}
    {...props}
  />
));
Toast.displayName = ToastPrimitive.Root.displayName;

const ToastTitle = forwardRef<
  ElementRef<typeof ToastPrimitive.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className = "", ...props }, ref) => (
  <ToastPrimitive.Title ref={ref} className={`font-medium ${className}`} {...props} />
));
ToastTitle.displayName = ToastPrimitive.Title.displayName;

const ToastDescription = forwardRef<
  ElementRef<typeof ToastPrimitive.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className = "", ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={className} {...props} />
));
ToastDescription.displayName = ToastPrimitive.Description.displayName;

export { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport };
