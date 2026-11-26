//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
)

func openBrowser(string) error {
	return errors.New("Mở bằng trình duyệt mặc định chỉ có trên Windows. Dùng --serve-only để chạy máy chủ cục bộ.")
}

func showError(err error) {
	fmt.Fprintln(os.Stderr, err)
}
