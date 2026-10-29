// Package handlers - Keys Handler
// Quản lý Access Key (license), hỗ trợ shared key và device-binding key
package handlers

import (
	"crypto/rand"
	"dkhp-backend/config"
	"dkhp-backend/models"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	keysMu   sync.RWMutex
	keysFile string
	dataDir  string
)

func init() {
	// Xác định vị trí file keys.json
	// Ưu tiên 1: thư mục ../data (khi chạy từ go-backend/ bằng go run)
	cwd, _ := os.Getwd()
	parentData := filepath.Join(cwd, "..", "data")
	if info, err := os.Stat(parentData); err == nil && info.IsDir() {
		dataDir, _ = filepath.Abs(parentData)
		keysFile = filepath.Join(dataDir, "keys.json")
		ensureDataStore()
		return
	}

	// Ưu tiên 2: thư mục ./data (khi chạy từ thư mục root project)
	cwdData := filepath.Join(cwd, "data")
	if info, err := os.Stat(cwdData); err == nil && info.IsDir() {
		dataDir, _ = filepath.Abs(cwdData)
		keysFile = filepath.Join(dataDir, "keys.json")
		ensureDataStore()
		return
	}

	// Ưu tiên 3: thư mục data cạnh executable (khi chạy file .exe đã build)
	exePath, err := os.Executable()
	if err != nil {
		exePath = "."
	}
	baseDir := filepath.Dir(exePath)
	dataDir = filepath.Join(baseDir, "data")
	keysFile = filepath.Join(dataDir, "keys.json")

	ensureDataStore()
}

func ensureDataStore() {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		fmt.Println("[Keys] Không thể tạo thư mục data:", err)
		return
	}
	if _, err := os.Stat(keysFile); os.IsNotExist(err) {
		initialKeys := map[string]models.KeyData{
			"DKHP-PRO-VIP": {
				Key:        "DKHP-PRO-VIP",
				KeyType:    "shared",
				Duration:   "forever",
				CreatedAt:  time.Now().UTC().Format(time.RFC3339),
				ExpiresAt:  nil,
				DeviceID:   nil,
				UsageCount: 0,
			},
			"DKHP-FREE-DEMO": {
				Key:        "DKHP-FREE-DEMO",
				KeyType:    "shared",
				Duration:   "30days",
				CreatedAt:  time.Now().UTC().Format(time.RFC3339),
				ExpiresAt:  nil,
				DeviceID:   nil,
				UsageCount: 0,
			},
		}
		saveKeysToFile(initialKeys)
	}
}

func readKeysFromFile() map[string]models.KeyData {
	keysMu.RLock()
	defer keysMu.RUnlock()

	data, err := os.ReadFile(keysFile)
	if err != nil {
		return map[string]models.KeyData{}
	}
	var keys map[string]models.KeyData
	if err := json.Unmarshal(data, &keys); err != nil {
		return map[string]models.KeyData{}
	}
	return keys
}

func saveKeysToFile(keys map[string]models.KeyData) bool {
	keysMu.Lock()
	defer keysMu.Unlock()

	data, err := json.MarshalIndent(keys, "", "  ")
	if err != nil {
		return false
	}
	return os.WriteFile(keysFile, data, 0644) == nil
}

func getMachineID() string {
	switch runtime.GOOS {
	case "windows":
		out, err := exec.Command("REG", "QUERY", `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid").Output()
		if err == nil {
			lines := strings.Split(string(out), "\n")
			for _, line := range lines {
				if strings.Contains(line, "MachineGuid") {
					fields := strings.Fields(line)
					if len(fields) >= 3 {
						return fields[len(fields)-1]
					}
				}
			}
		}
		hostname, _ := os.Hostname()
		return "win-" + hostname
	case "darwin":
		out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
		if err == nil && strings.Contains(string(out), "IOPlatformUUID") {
			for _, line := range strings.Split(string(out), "\n") {
				if strings.Contains(line, "IOPlatformUUID") {
					parts := strings.Split(line, `"`)
					if len(parts) >= 4 {
						return parts[3]
					}
				}
			}
		}
		return "mac-fallback"
	default:
		for _, path := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
			data, err := os.ReadFile(path)
			if err == nil {
				return strings.TrimSpace(string(data))
			}
		}
		return "linux-fallback"
	}
}

func calculateExpiration(duration string) *string {
	if duration == "forever" || duration == "" {
		return nil
	}
	now := time.Now()
	var expires time.Time
	switch duration {
	case "1day":
		expires = now.Add(24 * time.Hour)
	case "7days":
		expires = now.Add(7 * 24 * time.Hour)
	case "30days":
		expires = now.Add(30 * 24 * time.Hour)
	default:
		return nil
	}
	s := expires.UTC().Format(time.RFC3339)
	return &s
}

// PostValidateKey kiểm tra key bản quyền
// POST /api/keys/validate
func PostValidateKey(c *gin.Context) {
	var req models.KeyValidateRequest
	c.ShouldBindJSON(&req)

	rawKey := strings.TrimSpace(strings.ToUpper(req.Key))
	clientDeviceID := req.DeviceID
	studentID := strings.TrimSpace(req.StudentID)
	if clientDeviceID == "" {
		clientDeviceID = getMachineID()
	}

	if rawKey == "" {
		c.JSON(http.StatusOK, gin.H{"allowed": false, "message": "Vui lòng nhập mã Key"})
		return
	}

	allKeys := readKeysFromFile()
	keyData, exists := allKeys[rawKey]
	if !exists {
		c.JSON(http.StatusOK, gin.H{"allowed": false, "message": "Key không hợp lệ"})
		return
	}
	if keyData.Revoked {
		c.JSON(http.StatusOK, gin.H{"allowed": false, "message": "Key đã bị thu hồi"})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)

	// Tất cả key đều được kích hoạt/bind lần đầu; shared bind theo MSSV,
	// regular bind theo thiết bị hoặc MSSV được chọn lúc tạo.
	binding := keyData.Binding
	if keyData.KeyType == "shared" {
		binding = "student"
	}
	if binding == "" {
		binding = "device"
	}
	if binding == "student" && studentID == "" {
		c.JSON(http.StatusOK, gin.H{"allowed": false, "message": "Thiếu MSSV để kích hoạt key"})
		return
	}
	if keyData.BoundAt == nil {
		keyData.BoundAt = &now
		keyData.ExpiresAt = calculateExpiration(keyData.Duration)
		if binding == "student" {
			keyData.StudentID = studentID
		} else {
			keyData.DeviceID = &clientDeviceID
		}
	}

	if keyData.ExpiresAt != nil {
		expiresTime, _ := time.Parse(time.RFC3339, *keyData.ExpiresAt)
		if time.Now().After(expiresTime) {
			c.JSON(http.StatusOK, gin.H{"allowed": false, "message": "Key bản quyền đã hết hạn"})
			return
		}
	}
	if keyData.BoundAt != nil && ((binding == "student" && keyData.StudentID != studentID) || (binding != "student" && keyData.DeviceID != nil && *keyData.DeviceID != clientDeviceID)) {
		keyData.Revoked = true
		keyData.Violation = fmt.Sprintf("Key %s: đã kích hoạt bởi %s, phát hiện sử dụng bởi %s lúc %s", rawKey, firstNonEmpty(keyData.StudentID, deref(keyData.DeviceID)), firstNonEmpty(studentID, clientDeviceID), now)
		allKeys[rawKey] = keyData
		saveKeysToFile(allKeys)
		c.JSON(http.StatusOK, gin.H{"allowed": false, "revoked": true, "message": "Phát hiện key được dùng bởi tài khoản khác. Key đã bị thu hồi và admin đã được thông báo."})
		return
	}
	keyData.UsageCount++
	keyData.LastUsed = now
	allKeys[rawKey] = keyData
	saveKeysToFile(allKeys)

	c.JSON(http.StatusOK, gin.H{"allowed": true, "keyType": keyData.KeyType, "duration": keyData.Duration, "expiresAt": keyData.ExpiresAt, "message": "Key hợp lệ"})
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return "unknown"
}

// PostAdminLogin đăng nhập admin
// POST /api/keys/admin/login
func PostAdminLogin(c *gin.Context) {
	var body struct {
		Password string `json:"password"`
	}
	c.ShouldBindJSON(&body)

	adminPwd := os.Getenv("ADMIN_PASSWORD")
	if adminPwd == "" {
		adminPwd = config.AdminPassword
	}

	if body.Password == adminPwd {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "Đăng nhập Admin thành công"})
		return
	}
	c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Mật khẩu quản trị không chính xác"})
}

// RequireAdmin middleware kiểm tra quyền admin
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		adminPwd := os.Getenv("ADMIN_PASSWORD")
		if adminPwd == "" {
			adminPwd = config.AdminPassword
		}

		auth := c.GetHeader("Authorization")
		if auth == "Bearer "+adminPwd || auth == adminPwd {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Unauthorized Admin"})
	}
}

// PostAdminGenerateKey tạo key mới
// POST /api/keys/admin/keys/generate
func PostAdminGenerateKey(c *gin.Context) {
	var req models.KeyGenerateRequest
	c.ShouldBindJSON(&req)

	if req.KeyType == "" {
		req.KeyType = "regular"
	}
	if req.Duration == "" {
		req.Duration = "7days"
	}
	if req.Count < 1 {
		req.Count = 1
	}
	if req.Count > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Mỗi lần chỉ tạo tối đa 500 key"})
		return
	}
	if req.Binding != "student" && req.Binding != "device" {
		req.Binding = "device"
	}
	if req.KeyType == "shared" {
		req.Binding = "student"
	}

	allKeys := readKeysFromFile()
	created := make([]models.KeyData, 0, req.Count)
	if req.CustomKey != "" && req.Count > 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Không dùng tên tùy chỉnh khi tạo nhiều key"})
		return
	}
	for i := 0; i < req.Count; i++ {
		var newKey string
		if req.CustomKey != "" {
			newKey = strings.TrimSpace(strings.ToUpper(req.CustomKey))
			if _, exists := allKeys[newKey]; exists {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "Mã Key này đã tồn tại, vui lòng chọn tên khác"})
				return
			}
		} else {
			chars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
			for attempts := 0; attempts < 20; attempts++ {
				newKey = "DKHP-" + randomString(chars, 4) + "-" + randomString(chars, 4)
				if _, exists := allKeys[newKey]; !exists {
					break
				}
			}
			if _, exists := allKeys[newKey]; exists {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "Không thể sinh mã key ngẫu nhiên duy nhất"})
				return
			}
		}

		keyData := models.KeyData{
			Key:        newKey,
			KeyType:    req.KeyType,
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
			Duration:   req.Duration,
			ExpiresAt:  nil,
			DeviceID:   nil,
			UsageCount: 0,
			Binding:    req.Binding,
		}

		allKeys[newKey] = keyData
		created = append(created, keyData)
	}
	if !saveKeysToFile(allKeys) {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Không lưu được key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"key":     created[0], "keys": created,
		"message": fmt.Sprintf("Đã tạo thành công %d key", len(created)),
	})
}

// GetAdminKeys liệt kê tất cả key
// GET /api/keys/admin/keys
func GetAdminKeys(c *gin.Context) {
	allKeys := readKeysFromFile()
	keysArray := make([]models.KeyData, 0, len(allKeys))
	for _, k := range allKeys {
		keysArray = append(keysArray, k)
	}
	// Sort by createdAt descending (simple sort)
	for i := 0; i < len(keysArray); i++ {
		for j := i + 1; j < len(keysArray); j++ {
			if keysArray[j].CreatedAt > keysArray[i].CreatedAt {
				keysArray[i], keysArray[j] = keysArray[j], keysArray[i]
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "keys": keysArray})
}

// DeleteAdminKey xóa key
// DELETE /api/keys/admin/keys/:key
func DeleteAdminKey(c *gin.Context) {
	keyToDelete := strings.TrimSpace(strings.ToUpper(c.Param("key")))
	allKeys := readKeysFromFile()

	if _, exists := allKeys[keyToDelete]; exists {
		delete(allKeys, keyToDelete)
		saveKeysToFile(allKeys)
		c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("Đã xóa key %s", keyToDelete)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": false, "message": "Key không tồn tại"})
}

// PostAdminResetKey reset device binding
// POST /api/keys/admin/keys/:key/reset
func PostAdminResetKey(c *gin.Context) {
	keyToReset := strings.TrimSpace(strings.ToUpper(c.Param("key")))
	allKeys := readKeysFromFile()

	if keyData, exists := allKeys[keyToReset]; exists {
		keyData.DeviceID = nil
		keyData.BoundAt = nil
		allKeys[keyToReset] = keyData
		saveKeysToFile(allKeys)
		c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("Đã reset liên kết thiết bị cho key %s", keyToReset)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": false, "message": "Key không tồn tại"})
}

// GetAdminStats thống kê key
// GET /api/keys/admin/stats
func GetAdminStats(c *gin.Context) {
	allKeys := readKeysFromFile()
	total := len(allKeys)
	activeRegular := 0
	activeShared := 0
	boundKeys := 0
	usedToday := 0

	todayStr := time.Now().UTC().Format("2006-01-02")

	for _, k := range allKeys {
		if k.KeyType == "shared" {
			activeShared++
		} else {
			activeRegular++
		}
		if k.DeviceID != nil {
			boundKeys++
		}
		if strings.HasPrefix(k.LastUsed, todayStr) {
			usedToday++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"stats": gin.H{
			"total":         total,
			"activeRegular": activeRegular,
			"activeShared":  activeShared,
			"bound":         boundKeys,
			"usedToday":     usedToday,
		},
	})
}

func randomString(chars string, length int) string {
	result := make([]byte, length)
	for i := 0; i < length; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		result[i] = chars[n.Int64()]
	}
	return string(result)
}
