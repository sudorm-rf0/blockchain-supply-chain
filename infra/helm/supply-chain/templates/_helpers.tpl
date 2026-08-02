{{- define "supply-chain.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "supply-chain.labels" -}}
app.kubernetes.io/name: {{ include "supply-chain.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
