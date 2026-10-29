// Package models chứa các struct dữ liệu dùng chung trong ứng dụng
package models

import (
	"sync"
	"time"
)

// ========== Auth / Login ==========

// LoginRequest là payload đăng nhập từ client
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// LoginResponse là kết quả trả về sau đăng nhập
type LoginResponse struct {
	Success     bool        `json:"success"`
	Message     string      `json:"message"`
	Token       string      `json:"token,omitempty"`
	StudentInfo interface{} `json:"studentInfo,omitempty"`
}

// GenericResponse là response JSON chuẩn
type GenericResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Body    interface{} `json:"body,omitempty"`
}

// ========== Gateway ==========

// GatewayRequest là payload mã hóa từ frontend qua /api/gateway
type GatewayRequest struct {
	P string `json:"p"` // base64-encoded payload
}

// GatewayPayload là nội dung giải mã từ GatewayRequest
type GatewayPayload struct {
	Method   string      `json:"method"`
	Endpoint string      `json:"endpoint"`
	Data     interface{} `json:"data"`
	Token    string      `json:"token"`
}

// GatewayResponse là response mã hóa base64 trả về client
type GatewayResponse struct {
	R string `json:"r"` // base64-encoded response
}

// ========== Registration ==========

// AutoRegisterRequest là payload bắt đầu đăng ký tự động
type AutoRegisterRequest struct {
	ClassIDs     []interface{} `json:"classIds"`
	CourseGroups []CourseGroup `json:"courseGroups,omitempty"`
	Type         string        `json:"type"`
	Loop         int           `json:"loop"`
	Delay        int           `json:"delay"`
	DelayMax     int           `json:"delayMax"`
	TargetTime   string        `json:"targetTime,omitempty"`
	MSSV         string        `json:"mssv,omitempty"`
	Credentials  *Credentials  `json:"credentials,omitempty"`
	ProxyURL     string        `json:"proxyUrl,omitempty"` // HTTP/SOCKS5 proxy cho tài khoản này
}

// CourseGroup nhóm các lớp cùng một môn học
type CourseGroup struct {
	ClassIDs   []interface{} `json:"classIds"`
	TenHocPhan string        `json:"tenHocPhan,omitempty"`
	MaHocPhan  string        `json:"maHocPhan,omitempty"`
}

// Credentials lưu thông tin đăng nhập để auto-relogin
type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LogEntry là một dòng nhật ký trong tiến trình đăng ký
type LogEntry struct {
	Time    string `json:"time"`
	Message string `json:"message"`
	Type    string `json:"type"` // info, success, error, warning
}

// AutoRegisterSession là trạng thái của một phiên đăng ký tự động
type AutoRegisterSession struct {
	Mu                 sync.Mutex    `json:"-"`
	SessionID          string        `json:"sessionId"`
	Token              string        `json:"token"`
	Credentials        *Credentials  `json:"credentials,omitempty"`
	MSSV               string        `json:"mssv"`
	Active             bool          `json:"active"`
	Type               string        `json:"type"`
	Loop               int           `json:"loop"`
	Delay              int           `json:"delay"`
	DelayMax           int           `json:"delayMax"`
	ClassIDs           []string      `json:"classIds"`
	CourseGroups       []CourseGroup `json:"courseGroups"`
	PendingClassIDs    []string      `json:"pendingClassIds"`
	SuccessfulClassIDs []string      `json:"successfulClassIds"`
	Logs               []LogEntry    `json:"logs"`
	AllLogs            []LogEntry    `json:"allLogs"`
	Status             string        `json:"status"` // waiting, running, finished, stopped
	Result             interface{}   `json:"result"`
	CancelFunc         func()        `json:"-"`
	ProxyURL           string        `json:"proxyUrl,omitempty"`
}

// AddLog thêm một dòng log vào session (thread-safe)
func (s *AutoRegisterSession) AddLog(message, logType string) {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	entry := LogEntry{
		Time:    time.Now().UTC().Format(time.RFC3339Nano),
		Message: message,
		Type:    logType,
	}
	s.Logs = append(s.Logs, entry)
	s.AllLogs = append(s.AllLogs, entry)
}

// DrainLogs lấy và xóa các log chưa đọc (thread-safe)
func (s *AutoRegisterSession) DrainLogs() []LogEntry {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	logs := make([]LogEntry, len(s.Logs))
	copy(logs, s.Logs)
	s.Logs = s.Logs[:0]
	return logs
}

// ========== Events ==========

// AutoEventRequest là payload bắt đầu auto sự kiện
type AutoEventRequest struct {
	EventID    interface{} `json:"eventId"`
	DateID     interface{} `json:"dateId,omitempty"`
	Retries    int         `json:"retries"`
	DelayMin   int         `json:"delayMin"`
	DelayMax   int         `json:"delayMax"`
	TargetTime string      `json:"targetTime,omitempty"`
}

// AutoEventSession là trạng thái của phiên auto sự kiện
type AutoEventSession struct {
	Mu         sync.Mutex  `json:"-"`
	Active     bool        `json:"active"`
	Logs       []LogEntry  `json:"logs"`
	AllLogs    []LogEntry  `json:"allLogs"`
	Status     string      `json:"status"`
	Result     interface{} `json:"result"`
	CancelFunc func()      `json:"-"`
}

// AddLog thêm log vào event session (thread-safe)
func (s *AutoEventSession) AddLog(message, logType string) {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	entry := LogEntry{
		Time:    time.Now().UTC().Format(time.RFC3339Nano),
		Message: message,
		Type:    logType,
	}
	s.Logs = append(s.Logs, entry)
	s.AllLogs = append(s.AllLogs, entry)
}

// DrainLogs lấy và xóa log chưa đọc (thread-safe)
func (s *AutoEventSession) DrainLogs() []LogEntry {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	logs := make([]LogEntry, len(s.Logs))
	copy(logs, s.Logs)
	s.Logs = s.Logs[:0]
	return logs
}

// ========== Keys ==========

// KeyData lưu thông tin một license key
type KeyData struct {
	Key        string  `json:"key"`
	KeyType    string  `json:"keyType"`
	Duration   string  `json:"duration"`
	CreatedAt  string  `json:"createdAt"`
	ExpiresAt  *string `json:"expiresAt"`
	BoundAt    *string `json:"boundAt,omitempty"`
	DeviceID   *string `json:"deviceId"`
	UsageCount int     `json:"usageCount"`
	LastUsed   string  `json:"lastUsed,omitempty"`
	Binding    string  `json:"binding,omitempty"`
	StudentID  string  `json:"studentId,omitempty"`
	Revoked    bool    `json:"revoked,omitempty"`
	Violation  string  `json:"violation,omitempty"`
}

// KeyValidateRequest là payload kiểm tra key
type KeyValidateRequest struct {
	Key       string `json:"key"`
	DeviceID  string `json:"deviceId,omitempty"`
	StudentID string `json:"studentId,omitempty"`
}

// KeyGenerateRequest là payload tạo key mới
type KeyGenerateRequest struct {
	KeyType   string `json:"keyType"`
	Duration  string `json:"duration"`
	CustomKey string `json:"customKey,omitempty"`
	Count     int    `json:"count,omitempty"`
	Binding   string `json:"binding,omitempty"`
}

// RegisterClassRequest là payload đăng ký lớp thủ công
type RegisterClassRequest struct {
	ClassID interface{} `json:"classId"`
}
