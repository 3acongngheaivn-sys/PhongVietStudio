package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	shellExecute = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")
	messageBox   = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
)

func openBrowser(url string) error {
	target, err := syscall.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	verb, _ := syscall.UTF16PtrFromString("open")
	const showNormal = 1
	result, _, _ := shellExecute.Call(
		0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)),
		0, 0, showNormal,
	)
	if result <= 32 {
		return fmt.Errorf("Windows không mở được trình duyệt mặc định (mã %d).", result)
	}
	return nil
}

func showError(err error) {
	title, _ := syscall.UTF16PtrFromString("Phông Việt Studio")
	message, conversionErr := syscall.UTF16PtrFromString(err.Error())
	if conversionErr != nil {
		message, _ = syscall.UTF16PtrFromString("Không khởi động được Studio.")
	}
	const iconError = 0x10
	messageBox.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), iconError)
}
