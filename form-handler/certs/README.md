# TLS для MAX

`russian-trusted-root-ca.crt` — публичный корневой сертификат, не приватный ключ.

- Источник: https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer (Госуслуги, раздел https://www.gosuslugi.ru/crt).
- Загружен и проверен 03.10.2026.
- Subject/Issuer: `C=RU, O=The Ministry of Digital Development and Communications, CN=Russian Trusted Root CA`.
- SHA-256 fingerprint: `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`.
- Срок: 01.03.2022–27.02.2032. Проверены `ca=true` и подпись собственным публичным ключом.

Используется только в HTTPS-agent `max-client.js`, вместе со стандартными корнями Node. Проверка TLS/hostname включена; global trust store и Telegram не меняются. Тест контролирует fingerprint и отсутствие отключения проверки TLS. Обновлять сертификат только из официального источника с повторной проверкой fingerprint и срока.
