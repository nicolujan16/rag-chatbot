# Cómo funciona este chatbot

## Qué es esta aplicación

Es un chatbot RAG que responde únicamente con el contenido de los documentos que carga cada
usuario. Si la respuesta no está en esos documentos, contesta "no tengo esa información en
mis documentos" en lugar de inventarla. Fue construido por Nicolás Luján como proyecto
personal.

## Stack tecnológico

El frontend está hecho en Next.js 16 con App Router, React 19 y Tailwind CSS v4.

El backend corre sobre InsForge, una plataforma open source basada en Postgres que aporta
la base de datos, la autenticación y las edge functions escritas en Deno.

Los vectores se guardan en Postgres con la extensión pgvector, usando un índice HNSW y
distancia coseno.

Los modelos se consumen a través de OpenRouter: text-embedding-3-small de 1536 dimensiones
para los embeddings, y gpt-4o-mini para redactar las respuestas.

## Las dos edge functions

La function `ingest` se encarga de cargar un documento. Valida el token del usuario,
reserva la cuota de almacenamiento, parte el texto en fragmentos de unos 500 tokens con
solapamiento, genera todos los embeddings en un solo lote y los inserta en la base.

La function `ask` se encarga de responder. Valida el token, descuenta una pregunta del cupo
diario, convierte la pregunta en un embedding, recupera los 5 fragmentos más cercanos con
la función SQL `match_documents` y se los pasa al modelo junto con la instrucción de no
salirse de ese contexto. Devuelve la respuesta y las fuentes con el score de similitud de
cada una.

## Aislamiento entre usuarios

Cada usuario ve solo sus propios documentos y sus propios chats. El aislamiento está
aplicado en la base de datos mediante Row Level Security de Postgres, no en el código de la
aplicación.

La función de búsqueda `match_documents` es SECURITY INVOKER, lo que significa que corre con
el rol de quien la llama. La function `ask` la invoca con el cliente del usuario y no con el
cliente administrador, justamente para que las políticas RLS sigan aplicando durante la
búsqueda vectorial. Si usara el cliente administrador, la búsqueda recorrería los documentos
de todos los usuarios.

## Modelo de datos

La tabla `documents` guarda los fragmentos con su embedding de 1536 dimensiones y solo la
escriben las edge functions.

La tabla `ingested_files` guarda una fila por archivo con su tamaño en bytes, y funciona
como contador de la cuota de almacenamiento. Borrar una fila arrastra sus fragmentos por la
clave foránea y libera el espacio.

Las tablas `conversations` y `messages` guardan el historial del chat y las escribe el
navegador con el token del usuario.

La tabla `question_log` es append-only y cuenta el cupo diario de preguntas. No tiene
políticas RLS a propósito: si el usuario pudiera borrar sus filas, reiniciaría su propio
límite.

## Límites por usuario

Un usuario normal tiene 5 preguntas por día, 2 MiB de almacenamiento total de texto y 1 MiB
como tamaño máximo por archivo.

Las cuentas de demostración tienen un cupo más alto de 50 preguntas por día, porque están
pensadas para que alguien pueda probar el sistema sin quedarse sin preguntas a mitad de
camino.

Los tres límites viven solo en SQL, en funciones dedicadas. La interfaz los lee y las edge
functions los aplican, así que no pueden desincronizarse. El día se corta a medianoche UTC,
no en el huso horario local.

## Decisiones de diseño

La cuota de almacenamiento se reserva antes de generar un solo embedding. Si algo falla
después, esa reserva se libera. Al revés, dos subidas simultáneas podrían pasar ambas con el
último hueco libre.

Contar y registrar una pregunta es una sola operación atómica protegida por un lock por
usuario, para que dos pedidos concurrentes con el último crédito no pasen los dos.

Si falla el proveedor de modelos, la pregunta se devuelve al usuario, porque perder un
crédito por un error ajeno es mala experiencia.

El Markdown de las respuestas se renderiza sin HTML crudo, porque el texto proviene de un
modelo que repite contenido de archivos subidos por el usuario.

## Limitaciones conocidas

Solo acepta texto plano: archivos .txt, .md, .csv y .json. No procesa PDF.

No tiene memoria conversacional: cada pregunta viaja sola al modelo, así que una repregunta
que dependa de la respuesta anterior no funciona.

No tiene streaming, la respuesta aparece completa al terminar.

La recuperación no aplica umbral de similitud: siempre devuelve los 5 fragmentos más
cercanos aunque sean irrelevantes, y el filtrado queda a cargo del prompt del modelo.

No tiene tests automatizados.
