# Nicolás Luján — experiencia laboral y proyectos

## Importex Corporation

Desarrollador Web, remoto, de junio de 2026 a septiembre de 2026.

Diseña y desarrolla el nuevo sitio web de Trade360, el producto de software B2B de la
empresa, definiendo la arquitectura de información, la maquetación responsive y la
estructura de contenidos desde cero.

Implementa SEO técnico on-page (metadatos, jerarquía semántica y optimización de tiempos de
carga) para consolidar el sitio como canal de captación del producto.

## English Empire Institute, segundo contrato

Desarrollador Full Stack por contrato, remoto, de febrero de 2026 a abril de 2026. El sitio
del instituto es englishempire.com.ar

Amplió el sistema existente a un ERP/LMS completo incorporando autenticación y control de
acceso por rol en tres portales aislados: administración, docentes y alumnos, para más de
1000 alumnos activos.

Redujo el tiempo de cobranza de cuotas de días a minutos integrando Mercado Pago con
confirmación de pago vía webhooks, automatizando más de 1000 transacciones mensuales.

Eliminó más de 60 horas mensuales de seguimiento manual construyendo un pipeline de
notificaciones por email orientado a eventos sobre Firebase Cloud Functions, disparado por
cambios de estado en inscripciones y pagos.

## Diario Digital Del Interior

Desarrollador Full Stack por contrato, remoto, de agosto de 2025 a noviembre de 2025.

Construyó un portal de noticias en Next.js con SSG e ISR, datos estructurados y renderizado
optimizado para SEO, sosteniendo un LCP por debajo de 2 segundos.

Redujo el tiempo de publicación de horas a minutos desarrollando un CMS integrado para
noticias, eventos y destacados, operado a diario por 2 editores sin perfil técnico.

Diseñó la infraestructura sobre AWS Lambda con escalado automático, eliminando la gestión
de servidores durante toda la operación del diario.

## English Empire Institute, primer contrato

Desarrollador Full Stack por contrato, remoto, de junio de 2024 a septiembre de 2024.

Reemplazó la gestión administrativa manual del instituto construyendo un panel en React y
Firebase para alta, edición y baja de cursos y personal docente.

Centralizó el cobro de cursos permitiendo al equipo administrativo generar y actualizar
links de pago desde el panel, sin intervención de desarrollo.

## Proyecto personal: Spidey-Tracker

Mapa colaborativo en tiempo real, construido con React Native, Expo, TypeScript y Supabase.

Lo construyó de punta a punta: reportes geolocalizados sobre Google Maps, feed en vivo
sincronizado entre dispositivos y autenticación por email.

Incluye confirmación automática cuando dos usuarios independientes reportan el mismo
avistamiento dentro de 100 metros y 5 minutos, una regla aplicada en la base de datos y no
en la aplicación.

El repositorio es github.com/nicolujan16/spidey-tracker

## Proyecto personal: TuSanatorio

Herramienta de dictado a plan de cuidados para una clínica local, construida con Next.js,
React, TypeScript y Groq, usando Whisper más un modelo de lenguaje.

Whisper transcribe el dictado del médico y el modelo, restringido por un JSON Schema
estricto, lo convierte en pasos de cuidado discretos. El modelo tiene la instrucción de
nunca agregar lo que no está en la transcripción, y nada llega al paciente hasta que el
médico revisa y confirma. Fue construido en una hackathon de 48 horas.

El repositorio es github.com/nicolujan16/tu-sanatorio

## Proyecto personal: Pokernauta

Póker multijugador en tiempo real, construido con React, Firestore y AWS Lambda.

Construyó el juego completo: mesas, rondas de apuestas y resolución de manos para más de 10
mesas concurrentes y más de 60 jugadores simultáneos, con toda la evaluación de manos y la
validación de apuestas corriendo del lado del servidor y por debajo de 100 milisegundos por
acción.

El repositorio es github.com/nicolujan16/poker-app

## Proyecto personal: este chatbot RAG

El chatbot que está respondiendo esta pregunta. Construido con Next.js 16, InsForge,
Postgres con pgvector y OpenRouter. Responde solo con el contenido de los documentos
cargados y admite no saber cuando la respuesta no está en ellos.
