# Qué es un RAG (Retrieval-Augmented Generation)

## Definición

RAG significa Retrieval-Augmented Generation, en español "generación aumentada por
recuperación". Es una técnica para que un modelo de lenguaje responda usando información
que no estaba en sus datos de entrenamiento, sin necesidad de reentrenarlo.

La idea central es simple: en lugar de pedirle al modelo que responda de memoria, primero
se busca la información relevante en una base de documentos propia y después se le pasa
esa información al modelo junto con la pregunta. El modelo redacta la respuesta, pero los
hechos los pone el documento.

## El problema que resuelve

Un modelo de lenguaje entrenado hasta cierta fecha no conoce el manual interno de una
empresa, las notas de un equipo ni los documentos privados de una persona. Si se le
pregunta igual, muchas veces inventa una respuesta que suena correcta pero es falsa. A eso
se lo llama alucinación.

Reentrenar el modelo con esos documentos es caro, lento y hay que repetirlo cada vez que
cambia un archivo. RAG evita todo eso: los documentos viven en una base de datos, se
actualizan cuando uno quiere, y el modelo los lee en el momento de responder.

## Las dos etapas de un RAG

Un sistema RAG funciona en dos etapas separadas.

La primera es la **ingesta**, que ocurre cuando se carga un documento. El texto se parte en
fragmentos (chunks) de algunos cientos de palabras, cada fragmento se convierte en un
vector numérico llamado embedding, y ese vector se guarda en una base de datos vectorial.
Esta etapa se hace una sola vez por documento.

La segunda es la **consulta**, que ocurre cada vez que alguien pregunta algo. La pregunta
se convierte en un embedding con el mismo modelo, se buscan los fragmentos cuyos vectores
estén más cerca del de la pregunta, y esos fragmentos se le pasan al modelo de lenguaje
como contexto junto con la instrucción de responder solo con eso.

## Qué es un embedding

Un embedding es una lista de números que representa el significado de un texto. Dos textos
que hablan de lo mismo tienen embeddings cercanos entre sí, aunque no compartan ni una
palabra. Por eso una pregunta como "¿cuánto cuesta el plan más barato?" puede recuperar un
fragmento que dice "la tarifa básica es de 10 dólares mensuales", algo que una búsqueda por
palabras clave no encontraría.

La cercanía entre dos embeddings se mide normalmente con similitud coseno, un número entre
-1 y 1 donde los valores más altos indican mayor parecido semántico.

## Qué es una base de datos vectorial

Es una base de datos capaz de guardar embeddings y buscar, entre millones de ellos, los más
parecidos a uno dado sin comparar contra todos uno por uno. Para eso usa índices
aproximados como HNSW o IVFFlat, que sacrifican algo de exactitud a cambio de velocidad.

No hace falta una base de datos especializada: Postgres con la extensión pgvector cumple
esta función y permite guardar los vectores al lado del resto de los datos de la
aplicación.

## Por qué el troceado importa tanto

El tamaño del chunk es la decisión con más impacto en la calidad de un RAG. Fragmentos muy
grandes mezclan varios temas en un solo vector y diluyen la señal, así que la búsqueda se
vuelve imprecisa. Fragmentos muy chicos pierden el contexto necesario para que la respuesta
tenga sentido.

Una práctica habitual es usar fragmentos de 300 a 800 tokens con un solapamiento de unas
pocas decenas de tokens entre fragmentos consecutivos, para que una idea partida al medio
siga siendo recuperable desde ambos lados.

## Cómo se evalúa un RAG

Las dos mitades del sistema se evalúan por separado, porque fallan por motivos distintos.

La recuperación se mide con métricas como recall@k, que indica si el fragmento correcto
apareció entre los k recuperados, y MRR (Mean Reciprocal Rank), que además penaliza que
aparezca en una posición baja.

La generación se evalúa sobre la respuesta final: si es fiel al contexto recuperado, si no
agrega datos que no estaban, y si admite no saber cuando la respuesta efectivamente no está
en los documentos.

## Limitaciones conocidas de la técnica

RAG reduce las alucinaciones pero no las elimina: el modelo todavía puede malinterpretar un
fragmento o mezclar dos.

Si la recuperación falla, la respuesta falla, por buena que sea la instrucción que se le dé
al modelo. Un RAG no puede responder lo que no está en sus documentos, y esa es justamente
la propiedad que lo hace confiable.

Tampoco resuelve bien las preguntas que requieren agregar información de todo el corpus,
como "¿cuántos documentos mencionan X?", porque solo ve los pocos fragmentos que recuperó.
