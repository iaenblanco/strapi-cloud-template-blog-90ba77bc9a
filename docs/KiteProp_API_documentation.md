# KiteProp Rest API

---

## Authentication

### Authentication - API Key Auth

Alternative to login-based authentication. Use a permanent API Key for third-party integrations.

API Keys are generated from the admin panel (API Keys section) and are linked to a specific user in the organization. All requests made with the API Key will operate with that user's permissions.

#### How to use

Include the `X-API-Key` header in your requests. No login or Bearer token is needed.

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Error 4xx**

| Nombre | Descripción |
|--------|-------------|
| Unauthorized | Invalid or revoked API key. |

#### Example: Get profile with API Key

```
ANY https://www.kiteprop.com/api/v1/*
```

```bash
curl -H "X-API-Key: kp_xxxxx..." https://app.kiteprop.com/api/v1/profile
```

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 123,
    "email": "user@agency.com",
    "full_name": "John Doe",
    "office_id": 456,
    "role_id": 2
  },
  "errorMessage": null
}
```

**Unauthorized (HTTP/2 403 Forbidden)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Invalid API key",
  "details": []
}
```

---

### Authentication - Register

```
POST https://www.kiteprop.com/api/v1/auth/register
```

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| key | String | Registration key string |
| email | String | Agency email address |
| phone | String | Agency phone number |
| password | String | Account password |
| password_confirmation | String | Account password confirmation |
| name | String | Account/Agency name |
| first_name | String | User first name |
| last_name | String | User last name |
| registration_country | String | Registration country |
| referral_code (optional) | String\|Null | Referral or coupon code |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Success. |
| data | Object | |
| id | String | Organization identificator |
| name | String | Organization name |
| offices | Array | Offices list |
| users | Array | Users list |
| errorMessage | String | Error message |

**Error 4xx**

| Nombre | Descripción |
|--------|-------------|
| BadRequest | Login failed — Missing/Wrong api parameters. |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 3742,
    "name": "MyAgency",
    "offices": [
      {
        "id": 4096,
        "name": "Sucursal principal",
        "phone": "+5612345678",
        "email": "info@agency.com",
        "location_city_id": 7903,
        "main": 1,
        "address": null,
        "map_lat": null,
        "map_lng": null
      }
    ],
    "users": [
      {
        "id": 4096,
        "phone": "+5612345678",
        "phone_whatsapp": null,
        "email": "info@agency.com"
      }
    ]
  },
  "errorMessage": null
}
```

**BadRequest (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "referral_code": [
        "El código de cupon ó referido no es válido"
      ]
    }
  }
}
```

---

### Authentication - [DEPRECATED] Login

> **DEPRECATED** — Use API Key authentication instead.

Authenticate with email and password to obtain a temporary access token (expires in 24h).

For permanent authentication (third-party integrations), use an API Key instead. API Keys can be generated from the admin panel (API Keys section) and sent via the `X-API-Key` header.

```
POST https://www.kiteprop.com/api/v1/auth/login
```

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| email | String | User login email address |
| password | String | User login password |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Success. |
| data | Object | |
| access_token | String | Access token |
| expires_at | String | Expiration date |
| errorMessage | String | Error message |

**Error 4xx**

| Nombre | Descripción |
|--------|-------------|
| BadRequest | Login failed — Missing/Wrong api parameters. |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "access_token": "thisisjwttokenshouldbelonger",
    "expires_at": "2022-10-20T15:44:40.000000Z"
  },
  "errorMessage": null
}
```

**BadRequest (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Invalid credentials",
  "details": []
}
```

---

## Contacts

### Contacts - Create

Create a new contact with optional metadata and tagging.

```
POST https://www.kiteprop.com/api/v1/contacts
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| first_name | String | First name (max: 64) |
| last_name (optional) | String | Last name (max: 64) |
| charge (optional) | String | Job title or position (max: 96) |
| company (optional) | String | Company name (max: 96) |
| benefits_card (optional) | String | Benefits card identifier (max: 96) |
| facebook (optional) | String | Facebook profile or link (max: 96) |
| instagram (optional) | String | Instagram handle or link (max: 96) |
| website (optional) | String | Website URL (max: 96) |
| twitter (optional) | String | Twitter handle or link (max: 96) |
| summary (optional) | String | Description or notes (max: 6500) |
| dni (optional) | String | National ID number (min: 7, max: 16) |
| cuit (optional) | String | CUIT number |
| born_date (optional) | Date | Date of birth (YYYY-MM-DD) |
| phone_alternatives (optional) | String[] | Array of alternative phone numbers (min: 3 chars each) |
| phone (optional) | String | Primary phone number (min: 3) — Required if email is not present |
| email | String | Email address — Required |
| email_alternative (optional) | String | Alternative email (must differ from main email) |
| address (optional) | String | Contact address (min: 3) |
| location_city_id (optional) | Number | City ID (must exist in location_cities) |
| assigned_user_id (optional) | Number | Assigned user ID (must exist in users) |
| source (optional) | String | Source of contact (max: 96) |
| probs (optional) | Number | Probability level (0 to 3) |
| category_id (optional) | Number | Contact category ID (must exist in contact_categories) |
| tags (optional) | String[] | Array of tags (each tag must be alphanumeric, 3–16 chars) |
| user_id (optional) | Number | User ID of the property creator. |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Indicates if the request was successful. |
| data | Object | Contact information |
| id | Number | Contact ID |
| first_name | String | |
| last_name | String | |
| full_name | String | |
| email | String | |
| email_alternative | String\|null | |
| phone | String\|null | |
| phone_alternatives | String[]\|null | |
| category_id | Number\|null | |
| probs | Number\|null | |
| source | String\|null | |
| charge | String\|null | |
| company | String\|null | |
| facebook | String\|null | |
| instagram | String\|null | |
| website | String\|null | |
| twitter | String\|null | |
| summary | String\|null | |
| address | String\|null | |
| dni | String\|null | |
| cuit | String\|null | |
| last_activity | String | ISO8601 datetime |
| tags | Array | Array of tag strings |
| category | Object | Contact category |
| &nbsp;&nbsp;id | Number | |
| &nbsp;&nbsp;name | String | |
| created_at | String | ISO8601 datetime |
| updated_at | String | ISO8601 datetime |
| user | Object | Creator user |
| &nbsp;&nbsp;id | Number | |
| &nbsp;&nbsp;email | String | |
| &nbsp;&nbsp;phone | String | |
| &nbsp;&nbsp;phone_whatsapp | String | |
| &nbsp;&nbsp;full_name | String | |
| assigned_user | Object\|null | Assigned user info (nullable) |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 1123666,
    "first_name": "Laura",
    "last_name": "Martínez",
    "full_name": "Laura Martínez",
    "email": "laura@email.com",
    "email_alternative": null,
    "phone": "+5491122334455",
    "phone_alternatives": null,
    "category_id": 714,
    "probs": null,
    "source": null,
    "charge": "Gerenta de ventas",
    "company": "Inmuebles XYZ",
    "facebook": null,
    "instagram": null,
    "website": null,
    "twitter": null,
    "summary": null,
    "address": null,
    "dni": null,
    "cuit": null,
    "tags": ["vip", "recurrente"],
    "category": {
      "id": 714,
      "name": "Nuevo"
    },
    "last_activity": "2025-07-04T18:09:41.000000Z",
    "created_at": "2025-07-04T18:09:41.000000Z",
    "updated_at": "2025-07-04T18:09:41.000000Z",
    "user": {
      "id": 12345,
      "email": "developers@kiteprop.com",
      "phone": "+549111234567",
      "phone_whatsapp": "+549111234567",
      "full_name": "Juan Perez"
    },
    "assigned_user": null
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Hubo un error inesperado al guardar el contacto.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "email": [
        "El campo es obligatorio"
      ],
      "phone": [
        "El teléfono ya existe en el contacto 'Juan Perez'"
      ]
    }
  }
}
```

---

### Contacts - Delete

Deletes a contact by ID. This action is irreversible.

```
DELETE https://www.kiteprop.com/api/v1/contacts/:id
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Number | Contact ID (in URL path) |

**Success Response (HTTP/1.1 204 No Content)**

```
HTTP/1.1 204 No Content
```

**Not Found Response (HTTP/1.1 404 Not Found)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "El contacto no existe.",
  "details": []
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudo eliminar el contacto.",
  "details": []
}
```

---

### Contacts - List Categories

Retrieve the list of available contact categories with their metadata, including description, maximum stay in the category, and whether it is the default category.

```
GET https://www.kiteprop.com/api/v1/contacts/categories
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| data | Object[] | List of contact categories |
| id | Number | Category ID |
| name | String | Category name |
| description | String | Category description |
| maximum_stay | Number\|null | Maximum days to stay in this category (or null if unlimited) |
| default | Boolean | Indicates if this is the default category |

**Success Response (HTTP/1.1 200 OK)**

```json
{
  "data": [
    {
      "id": 7,
      "name": "Recien llegados",
      "description": "Necesita ser contactado",
      "maximum_stay": 3,
      "default": true
    },
    {
      "id": 8,
      "name": "Contactado",
      "description": "Contactado pero aún sin calificar",
      "maximum_stay": 8,
      "default": false
    },
    {
      "id": 9,
      "name": "Siguiendo",
      "description": "En pleno proceso de actividad",
      "maximum_stay": 10,
      "default": false
    },
    {
      "id": 10,
      "name": "Visitas",
      "description": "Contactos en proceso de visitas (pactadas)",
      "maximum_stay": 10,
      "default": false
    },
    {
      "id": 11,
      "name": "Futuro",
      "description": "Contactos que deben verse mas adelante",
      "maximum_stay": 90,
      "default": false
    },
    {
      "id": 12,
      "name": "Descartado",
      "description": "No es un cliente potencial calificado",
      "maximum_stay": null,
      "default": false
    }
  ]
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudieron obtener las categorías de contacto.",
  "details": []
}
```

---

### Contacts - List

Retrieve a paginated list of contacts. You can filter the results by several optional parameters.

```
GET https://www.kiteprop.com/api/v1/contacts
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| q (optional) | String | Search query (matches name, email, phone, etc.) |
| source (optional) | String | Contact source (e.g. "mercadolibre", "toctoc") |
| category_id (optional) | Number | Contact category ID |
| probs (optional) | Number | Probability level. Range: 0-3 |
| tags (optional) | String[] | Filter by one or more tag values |
| user_or_assignee (optional) | Number | User ID that is either creator or assignee |
| assignee (optional) | Number | Assigned user ID |
| page (optional) | Number | Page number for pagination |
| limit (optional) | Number | Number of items per page (allowed values: 5, 10, 15, 20, 25). Range: 1-25 |
| order (optional) | String | Sort order. Allowed values: `"id:asc"`, `"id:desc"` |

**Success Response (HTTP/1.1 200 OK)**

```json
{
  "data": [
    {
      "id": 1036608,
      "first_name": "Florencia",
      "last_name": "Serra",
      "full_name": "Florencia Serra",
      "email": "florencia.serra@example.com",
      "email_alternative": "flor.serra.alt@example.com",
      "phone": "+54 9 341 2275819",
      "phone_alternatives": ["+54 9 341 1111111", "+54 9 341 2222222"],
      "category_id": 9,
      "probs": 2,
      "source": "mercadolibre",
      "charge": "Agente Inmobiliaria",
      "company": "Inmobiliaria del Sur",
      "facebook": "https://facebook.com/flor.serra.example",
      "instagram": "@flor.serra.example",
      "website": "https://www.inmobiliariadelsur.com",
      "twitter": "@florSerraProp",
      "summary": "Cliente interesada en propiedades de 3 ambientes en zona oeste.",
      "address": "Calle Falsa 123",
      "dni": "30111222",
      "cuit": "20301112223",
      "last_activity": "2025-07-04T18:40:46.000000Z",
      "tags": ["arriendos", "newsletter", "vip"],
      "category": {
        "id": 9,
        "name": "Siguiendo"
      },
      "created_at": "2025-01-29T21:38:51.000000Z",
      "updated_at": "2025-07-04T18:40:46.000000Z",
      "user": {
        "id": 33,
        "email": "asesor@kiteprop.com",
        "phone": "+54 9 341 3888888",
        "phone_whatsapp": "+54 9 341 3666666",
        "full_name": "Claudia Ramírez"
      },
      "assigned_user": {
        "id": 45,
        "email": "carla@kiteprop.com",
        "phone": "+54 9 341 3777777",
        "phone_whatsapp": "+54 9 341 3555555",
        "full_name": "Carla Juárez"
      }
    }
  ],
  "links": {
    "first": "https://www.kiteprop.com/api/v1/contacts?page=1",
    "last": "https://www.kiteprop.com/api/v1/contacts?page=10",
    "prev": null,
    "next": "https://www.kiteprop.com/api/v1/contacts?page=2"
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 10,
    "path": "https://www.kiteprop.com/api/v1/contacts",
    "per_page": 15,
    "to": 15,
    "total": 150,
    "links": [
      { "url": null, "label": "&laquo; Anterior", "active": false },
      { "url": "https://www.kiteprop.com/api/v1/contacts?page=1", "label": "1", "active": true },
      { "url": "https://www.kiteprop.com/api/v1/contacts?page=2", "label": "2", "active": false },
      { "url": null, "label": "Siguiente &raquo;", "active": false }
    ]
  }
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudo obtener la lista de contactos.",
  "details": []
}
```

---

### Contacts - Show

Retrieve a single contact by its ID.

```
GET https://www.kiteprop.com/api/v1/contacts/:id
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Number | Contact ID (in URL path) |

**Success Response (HTTP/1.1 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 1036608,
    "first_name": "Florencia",
    "last_name": "Serra",
    "full_name": "Florencia Serra",
    "email": "florencia.serra@example.com",
    "email_alternative": "flor.serra.alt@example.com",
    "phone": "+54 9 341 2275819",
    "phone_alternatives": ["+54 9 341 1111111", "+54 9 341 2222222"],
    "category_id": 9,
    "probs": 2,
    "source": "argenprop",
    "charge": "Agente Inmobiliaria",
    "company": "Inmobiliaria del Sur",
    "facebook": "https://facebook.com/flor.serra.example",
    "instagram": "@flor.serra.example",
    "website": "https://www.inmobiliariadelsur.com",
    "twitter": "@florSerraProp",
    "summary": "Cliente interesada en propiedades de 3 ambientes en zona oeste.",
    "address": "Calle Falsa 123",
    "dni": "30111222",
    "cuit": "20301112223",
    "last_activity": "2025-07-04T18:40:46.000000Z",
    "tags": ["arriendos", "newsletter", "vip"],
    "category": {
      "id": 9,
      "name": "Siguiendo"
    },
    "created_at": "2025-01-29T21:38:51.000000Z",
    "updated_at": "2025-07-04T18:40:46.000000Z",
    "user": {
      "id": 33,
      "email": "asesor@kiteprop.com",
      "phone": "+54 9 341 3888888",
      "phone_whatsapp": "+54 9 341 3666666",
      "full_name": "Claudia Ramírez"
    },
    "assigned_user": {
      "id": 45,
      "email": "carla@kiteprop.com",
      "phone": "+54 9 341 3777777",
      "phone_whatsapp": "+54 9 341 3555555",
      "full_name": "Carla Juárez"
    }
  },
  "errorMessage": null
}
```

**Not Found Response (HTTP/1.1 404 Not Found)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "El contacto no fue encontrado.",
  "details": []
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudo obtener el contacto.",
  "details": []
}
```

---

### Contacts - Update

Update a contact's information. You can send only the fields you want to update.

```
PUT https://www.kiteprop.com/api/v1/contacts/:id
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Number | Contact ID (in URL path) |
| first_name (optional) | String | First name (max: 64) |
| last_name (optional) | String | Last name (max: 64) |
| charge (optional) | String | Job title or position (max: 96) |
| company (optional) | String | Company name (max: 96) |
| benefits_card (optional) | String | Benefits card identifier (max: 96) |
| facebook (optional) | String | Facebook profile or link (max: 96) |
| instagram (optional) | String | Instagram handle or link (max: 96) |
| website (optional) | String | Website URL (max: 96) |
| twitter (optional) | String | Twitter handle or link (max: 96) |
| summary (optional) | String | Description or notes (max: 6500) |
| dni (optional) | String | National ID number (min: 7, max: 16) |
| cuit (optional) | String | CUIT number |
| born_date (optional) | Date | Date of birth (YYYY-MM-DD) |
| phone_alternatives (optional) | String[] | Array of alternative phone numbers (min: 3 chars each) |
| phone (optional) | String | Primary phone number (min: 3) |
| email (optional) | String | Email address |
| email_alternative (optional) | String | Alternative email (must differ from main email) |
| address (optional) | String | Contact address (min: 3) |
| location_city_id (optional) | Number | City ID (must exist in location_cities) |
| assigned_user_id (optional) | Number | Assigned user ID (must exist in users) |
| source (optional) | String | Source of contact (max: 96) |
| probs (optional) | Number | Probability level (0 to 3) |
| category_id (optional) | Number | Contact category ID (must exist in contact_categories) |
| tags (optional) | String[] | Array of tags (each tag must be alphanumeric, 3–16 chars) |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Indicates if the request was successful. |
| data | Object | Updated contact information (same structure as creation) |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 1123666,
    "first_name": "Laura",
    "last_name": "Martínez",
    "full_name": "Laura Martínez",
    "email": "laura@email.com",
    "email_alternative": null,
    "phone": "+5491199999999",
    "phone_alternatives": null,
    "category_id": 714,
    "probs": null,
    "source": null,
    "charge": "Gerenta de ventas",
    "company": "Inmuebles XYZ",
    "facebook": null,
    "instagram": null,
    "website": null,
    "twitter": null,
    "summary": null,
    "address": null,
    "dni": null,
    "cuit": null,
    "last_activity": "2025-07-04T18:25:41.000000Z",
    "tags": ["vip", "recurrente"],
    "category": {
      "id": 714,
      "name": "Nuevo"
    },
    "created_at": "2025-07-04T18:09:41.000000Z",
    "updated_at": "2025-07-04T18:25:41.000000Z",
    "user": {
      "id": 12345,
      "email": "developers@kiteprop.com",
      "phone": "+549111234567",
      "phone_whatsapp": "+549111234567",
      "full_name": "Juan Perez"
    },
    "assigned_user": {
      "id": 345,
      "email": "asesor@inmobiliaria.com",
      "phone": "+5491122223333",
      "phone_whatsapp": "+5491122223333",
      "full_name": "Carla Romero"
    }
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Error al actualizar el contacto.",
  "details": []
}
```

**Error Validation Response (HTTP/1.1 422 Unprocessable Entity)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "email": [
        "El email no es válido."
      ],
      "tags.0": [
        "El tag debe tener al menos 3 caracteres."
      ]
    }
  }
}
```

---

## Messages

### Messages - Create

Create a new message.

```
POST https://www.kiteprop.com/api/v1/messages
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| first_name (optional) | String | First name |
| last_name (optional) | String | Last name |
| name (optional) | String | Full name (You can use this instead of first_name and last_name) |
| email | String | Contact email |
| phone (optional) | String | Contact phone |
| body | String | Contact message |
| property_id | Number | Property id from KiteProp |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Success. |
| data | Object | |
| id | Number | Message id |
| property_id | Number | Property id |
| source | String | Message source |
| body | String | Message body |
| contact | Object | |
| &nbsp;&nbsp;full_name | String | Contact name |
| &nbsp;&nbsp;email | String | Contact email |
| &nbsp;&nbsp;phone (optional) | String\|Null | Contact phone |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 9876543,
    "source": "site",
    "property_id": 12345,
    "body": "Hola, estoy interesado en la propiedad",
    "contact": {
      "full_name": "Juan Gonzalez",
      "email": "juan@email.com",
      "phone": "+549111000000"
    }
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "El mensaje ya existe.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "email": [
        "El campo es obligatorio"
      ]
    }
  }
}
```

---

### Messages - List

Retrieve a list of messages.

```
GET https://www.kiteprop.com/api/v1/messages
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| q (optional) | String | Search by query string |
| date (optional) | String | Message date in format YYYY-MM-DD |
| op_type (optional) | String | Operation type. Allowed values: `'rental'`, `'sale'`, `'temporary_rental'` |
| type (optional) | String | Property type. Allowed values: `'houses'`, `'apartments'`, `'ph'`, `'offices'`, `'residential_lands'`, `'industrial_lands'`, `'warehouses'`, `'industrial_warehouses'`, `'farms'`, `'parking_spaces'`, `'retail_spaces'`, `'medical_spaces'`, `'cemetery_lots'`, `'businesses'`, `'boat_storages'` |
| page (optional) | String | Pagination page number |
| limit (optional) | Number | Number of items per page (default 15, max 25) |
| order (optional) | String | Order by id ascending or descending. Allowed values: `'id:asc'`, `'id:desc'` |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Success. |
| data | Object | |
| id | Number | Message id |
| property_id (optional) | String\|Null | Property id |
| created_at | String | Message source |
| source | String | Message source |
| body | String | Message body |
| contact | Object | |
| &nbsp;&nbsp;id | String | Contact id |
| &nbsp;&nbsp;full_name | String | Contact name |
| &nbsp;&nbsp;created_at | String | Creation date |
| &nbsp;&nbsp;updated_at | String | Update date |
| &nbsp;&nbsp;email (optional) | String\|Null | Contact email |
| &nbsp;&nbsp;phone (optional) | String\|Null | Contact phone |

**Success Response (HTTP/2 200 OK)**

```json
{
  "data": [
    {
      "id": 509375,
      "created_at": "2024-02-07T21:57:29.000000Z",
      "body": "Hola, Soy Juan. Estoy interesado en su anuncio. Me pueden contactar?",
      "source": "olx",
      "property_id": 186421,
      "contact": {
        "id": 561678,
        "full_name": "Juan Perez",
        "email": "juan@gmail.com",
        "phone": "+5491112345678",
        "created_at": "2024-02-07T21:57:29.000000Z",
        "updated_at": "2024-03-07T11:35:46.000000Z"
      }
    },
    {
      "id": 481623,
      "created_at": "2024-12-30T22:01:12.000000Z",
      "body": "Hola, Soy Julian. Estoy interesado en su anuncio. Me pueden contactar?",
      "source": "mercadolibre",
      "property_id": 156548,
      "contact": {
        "id": 516526,
        "full_name": "Julian Gomez",
        "email": "julian@gmail.com",
        "phone": "+5491112345678",
        "created_at": "2024-12-30T22:01:12.000000Z",
        "updated_at": "2024-03-07T11:32:18.000000Z"
      }
    }
  ],
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 75,
    "per_page": 15,
    "to": 15,
    "total": 1117
  }
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "email": [
        "El campo es obligatorio"
      ]
    }
  }
}
```

---

## Properties

### Properties - Change Status

Changes property status.

```
PUT https://www.kiteprop.com/api/v1/properties/{id}/status
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| v | String | Property status. Allowed values: `'reserved'`, `'sold'`, `'rented'`, `'active'`, `'inactive'` |
| extraData | Object | Additional data for status change |
| &nbsp;&nbsp;final_price (optional) | Number | Final operation price (required when status is not `'inactive'`) |
| &nbsp;&nbsp;final_currency_id (optional) | Number | Currency for final price id (1=USD, 2=ARS, 3=MXN, 4=BRL, 5=CLP, 6=COP, 7=DOP, 8=EUR, 9=PEN, 10=UF, 11=UYU, 12=BTC, 13=ETH, 14=PYG, 15=BOP). Allowed values: 1–15 |
| &nbsp;&nbsp;reserved_price (optional) | Number | Reservation amount (required when status is `'reserved'`) |
| &nbsp;&nbsp;reserved_currency_id (optional) | Number | Currency for reservation id (same values as final_currency_id) (required when status is `'reserved'`) |
| &nbsp;&nbsp;reserved_days (optional) | Number | Number of days for reservation (required when status is `'reserved'`) |
| &nbsp;&nbsp;optype (optional) | String | Operation type (for reserved status: `'sale'`, `'rental'` or `'temporary_rental'`) (required when status is `'reserved'` or `'rented'`) |
| &nbsp;&nbsp;contact_id (optional) | Number | ID of the owner contact associated with the property (required when status is not `'inactive'`) |
| &nbsp;&nbsp;user_performer_id (optional) | Number | User ID who managed the operation (required when status is `'reserved'`) (required when status is not `'inactive'`) |
| &nbsp;&nbsp;comments (optional) | String | Additional comments |
| &nbsp;&nbsp;reason (optional) | String | Reason for status change (required when status is `'inactive'`). Use `'no_longer_interested'` when owner is not interested anymore, `'no_portals_or_website'` when property should not appear in portals, `'sold_or_rented_keep'` when property was sold/rented but should be kept, `'property_issue'` when there's a problem with the property, `'other'` for any other reason. Allowed values: `'no_longer_interested'`, `'no_portals_or_website'`, `'sold_or_rented_keep'`, `'property_issue'`, `'other'` |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 378128,
    "code": "KP378128",
    "internal_id": "ME4349_28",
    "source_id": "TV-493391-22",
    "status": "active",
    "type": "houses",
    "title": "Importante nueva casa en venta o arriendo",
    "description": "Descubre esta importante nueva casa en venta o arriendo...",
    "images_list": [],
    "link_youtube": "https://www.youtube.com/watch?v=XrkeQqdOFgw",
    "link_360": "https://my.matterport.com/show?play=1&lang=en-US&m=hrsCW8h7WNm",
    "country": null,
    "state": null,
    "city": null,
    "neighborhood": null,
    "zone": null,
    "postal_code": 12345,
    "address": "Condes 1093",
    "guidance_address": "Condes al 1000",
    "hide_exact_location": false,
    "geo": null,
    "rooms": 5,
    "bedrooms": 2,
    "bathrooms": 2,
    "half_bathrooms": 1,
    "parkings": 1,
    "floors_in_building": 2,
    "floor": 0,
    "total_meters": 300,
    "covered_meters": 150,
    "uncovered_meters": 150,
    "terrain_size": 300,
    "front_meters": 15,
    "side_meters": 20,
    "year_built": 2025,
    "is_new_construction": true,
    "delivery_date": "2025-01-27",
    "fit_for_credit": true,
    "accept_barter": true,
    "accept_pets": true,
    "currency": "usd",
    "expenses_currency": "usd",
    "hide_prices": false,
    "for_sale": true,
    "for_sale_price": 250000,
    "for_rent": true,
    "for_rent_price": 1000,
    "for_temp_rental": true,
    "for_temp_rental_price_day": 60,
    "for_temp_rental_price_week": 1000,
    "for_temp_rental_price_month": 1000,
    "sleeps_count": 12,
    "expenses": "40",
    "tags": [],
    "created_at": "2025-01-27T00:35:28.000000Z",
    "updated_at": "2025-01-27T00:53:10.000000Z",
    "user": {
      "id": 3507,
      "email": "api@cecinba.com",
      "phone": "12345",
      "phone_whatsapp": null,
      "full_name": "Cecin API"
    },
    "organization": {
      "name": "CeCinCba",
      "phone": null,
      "email": null,
      "avatar": "2079-d88c847b3990f087d2d40f2e29f4532c.jpg"
    }
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "title": [
        "El campo es obligatorio"
      ]
    }
  }
}
```

---

### Properties - Create

Creates a new property.

```
POST https://www.kiteprop.com/api/v1/properties
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| title | String | Title of the property. |
| type (optional) | String | Property type. Allowed values: `'houses'`, `'apartments'`, `'ph'`, `'offices'`, `'residential_lands'`, `'industrial_lands'`, `'warehouses'`, `'industrial_warehouses'`, `'farms'`, `'parking_spaces'`, `'retail_spaces'`, `'medical_spaces'`, `'cemetery_lots'`, `'businesses'`, `'boat_storages'` |
| status | String | Property status. Allowed values: `'reserved'`, `'sold'`, `'rented'`, `'suspended'`, `'active'`, `'inactive'`, `'active_unpublished'` |
| currency_id | Number | Currency id (1=USD, 2=ARS, 6=CLP, 19=UF, 11=EUR). Allowed values: 1, 2, 6, 11, 19 |
| expenses_currency_id | Number | Expenses currency id (1=USD, 2=ARS, 6=CLP, 19=UF, 11=EUR). Allowed values: 1, 2, 6, 11, 19 |
| contact_id | Number | ID of the owner contact associated with the property. |
| location_city_id | Number | ID of the city where the property is located. |
| location_neighborhood_id | Number | ID of the neighborhood where the property is located. |
| source_id (optional) | String | Source identifier (when importing). |
| user_id (optional) | Number | User ID of the property creator. |
| optype | Object | Operation type details. |
| &nbsp;&nbsp;sale | Boolean | Indicates if the property is for sale. |
| &nbsp;&nbsp;sale_price (optional) | Number | Sale price of the property. |
| &nbsp;&nbsp;rental | Boolean | Indicates if the property is available for rental. |
| &nbsp;&nbsp;rent (optional) | Number | Rental price. |
| &nbsp;&nbsp;temporary_rental | Boolean | Indicates if the property is available for temporary rental. |
| &nbsp;&nbsp;monthly_rate (optional) | Number | Monthly rental rate. |
| &nbsp;&nbsp;weekly_rate (optional) | Number | Weekly rental rate. |
| &nbsp;&nbsp;daily_rate (optional) | Number | Daily rental rate. |
| &nbsp;&nbsp;minimum_stay (optional) | String | Minimum stay duration for temporary rentals. |
| &nbsp;&nbsp;sleeps_count (optional) | Number | Number of people the property can accommodate. |
| &nbsp;&nbsp;commission_amount (optional) | String | Commission percentage. |
| &nbsp;&nbsp;commission_owner (optional) | String | Commission percentage paid by the owner. |
| &nbsp;&nbsp;commission_buyer (optional) | String | Commission percentage paid by the buyer. |
| detail | Object | Property details. |
| &nbsp;&nbsp;internal_id (optional) | String | Internal property identifier. |
| &nbsp;&nbsp;expenses (optional) | String | Monthly expenses for the property. |
| &nbsp;&nbsp;zone (optional) | String | Zone or area of the property. |
| &nbsp;&nbsp;postal_code (optional) | String | Postal code of the property. |
| &nbsp;&nbsp;guidance_address (optional) | String | Reference address for guidance. |
| &nbsp;&nbsp;address | String | Full address of the property. |
| &nbsp;&nbsp;fit_for_credit | Boolean | Indicates if the property qualifies for credit. |
| &nbsp;&nbsp;accept_barter | Boolean | Indicates if the property accepts barter. |
| &nbsp;&nbsp;accept_pets | Boolean | Indicates if pets are allowed. |
| &nbsp;&nbsp;new_construction | Boolean | Indicates if the property is a new construction. |
| &nbsp;&nbsp;delivery_date (optional) | String | Delivery date for new constructions (YYYY-MM-DD). |
| &nbsp;&nbsp;rooms | Number | Total number of rooms in the property. |
| &nbsp;&nbsp;bedrooms | Number | Number of bedrooms. |
| &nbsp;&nbsp;bathrooms | Number | Number of full bathrooms. |
| &nbsp;&nbsp;half_bathrooms (optional) | Number | Number of half bathrooms. |
| &nbsp;&nbsp;parkings (optional) | Number | Number of parking spaces. |
| &nbsp;&nbsp;floor (optional) | Number | Floor of the property (if applicable). |
| &nbsp;&nbsp;floors_in_building (optional) | Number | Total floors in the building (if applicable). |
| &nbsp;&nbsp;year_built (optional) | Number | Year the property was built. |
| &nbsp;&nbsp;registration_code (optional) | String | Property registration code. |
| &nbsp;&nbsp;storage_room_code (optional) | String | Property storage room code. |
| &nbsp;&nbsp;parking_code (optional) | String | Property parking code. |
| &nbsp;&nbsp;description | String | Public description of the property. |
| &nbsp;&nbsp;private_description (optional) | String | Private notes or description. |
| &nbsp;&nbsp;network_description (optional) | String | Internal comments for colleagues. |
| &nbsp;&nbsp;collaboration_tasks (optional) | String | Notes for collaboration. |
| &nbsp;&nbsp;link_youtube (optional) | String | YouTube link to a property video. |
| &nbsp;&nbsp;link_360_iframe (optional) | String | Link to a 360° virtual tour. |
| &nbsp;&nbsp;total_meters | Number | Total area of the property in square meters. |
| &nbsp;&nbsp;covered_meters | Number | Covered area in square meters. |
| &nbsp;&nbsp;uncovered_meters | Number | Uncovered area in square meters. |
| &nbsp;&nbsp;terrain_size | Number | Total terrain size in square meters. |
| &nbsp;&nbsp;terrain_width | Number | Width of the terrain in meters. |
| &nbsp;&nbsp;terrain_height | Number | Height of the terrain in meters. |
| &nbsp;&nbsp;map_lat | String | Latitude of the property location. |
| &nbsp;&nbsp;map_lng | String | Longitude of the property location. |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 378128,
    "code": "KP378128",
    "internal_id": "ME4349_28",
    "source_id": "TV-493391-22",
    "status": "active",
    "type": "houses",
    "title": "Importante nueva casa en venta o arriendo",
    "description": "Descubre esta importante nueva casa en venta o arriendo...",
    "images_list": [],
    "link_youtube": "https://www.youtube.com/watch?v=XrkeQqdOFgw",
    "link_360": "https://my.matterport.com/show?play=1&lang=en-US&m=hrsCW8h7WNm",
    "country": null,
    "state": null,
    "city": null,
    "neighborhood": null,
    "zone": null,
    "postal_code": 12345,
    "address": "Condes 1093",
    "guidance_address": "Condes al 1000",
    "hide_exact_location": false,
    "geo": null,
    "rooms": 5,
    "bedrooms": 2,
    "bathrooms": 2,
    "half_bathrooms": 1,
    "parkings": 1,
    "floors_in_building": 2,
    "floor": 0,
    "total_meters": 300,
    "covered_meters": 150,
    "uncovered_meters": 150,
    "terrain_size": 300,
    "front_meters": 15,
    "side_meters": 20,
    "year_built": 2025,
    "is_new_construction": true,
    "delivery_date": "2025-01-27",
    "fit_for_credit": true,
    "accept_barter": true,
    "accept_pets": true,
    "currency": "usd",
    "expenses_currency": "usd",
    "hide_prices": false,
    "for_sale": true,
    "for_sale_price": 250000,
    "for_rent": true,
    "for_rent_price": 1000,
    "for_temp_rental": true,
    "for_temp_rental_price_day": 60,
    "for_temp_rental_price_week": 1000,
    "for_temp_rental_price_month": 1000,
    "sleeps_count": 12,
    "expenses": "40",
    "tags": [],
    "created_at": "2025-01-27T00:35:28.000000Z",
    "updated_at": "2025-01-27T00:53:10.000000Z",
    "user": {
      "id": 3507,
      "email": "api@cecinba.com",
      "phone": "12345",
      "phone_whatsapp": null,
      "full_name": "Cecin API"
    },
    "organization": {
      "name": "CeCinCba",
      "phone": null,
      "email": null,
      "avatar": "2079-d88c847b3990f087d2d40f2e29f4532c.jpg"
    }
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The given data was invalid.",
  "details": {
    "attributes": {
      "title": [
        "El campo es obligatorio"
      ]
    }
  }
}
```

---

### Properties - Delete

Deletes a property by ID. This action is irreversible.

> To ensure a correct shutdown, we recommend to unpublish from portals or inactivate it before deleting.

```
DELETE https://www.kiteprop.com/api/v1/properties/:id
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Number | Property ID (in URL path) |

**Success Response (HTTP/1.1 204 No Content)**

```
HTTP/1.1 204 No Content
```

**Not Found Response (HTTP/1.1 404 Not Found)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Resource not found - Property",
  "details": []
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudo eliminar la propiedad.",
  "details": []
}
```

---

### Properties - List Activities

Lists all property activities. Returns paginated results.

```
GET https://www.kiteprop.com/api/v1/properties/activities
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| type (optional) | String | Filter by activity type. Allowed values: `'status_changed'`, `'price_update'`, `'user_assignment'`, `'data_changed'`, `'category_changed'`, `'delete_property'` |
| date (optional) | String | Filter by date (format: YYYY-MM-DD) |
| user (optional) | Number\|Array[Number] | Filter by user ID(s) |
| property_id (optional) | Number | Filter by property ID |
| order (optional) | String | Results order (default: id:desc). Allowed values: `'id:asc'`, `'id:desc'`, `'created_at:asc'`, `'created_at:desc'` |
| page (optional) | Number | Page number |
| limit (optional) | Number | Results limit (default: 15) |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| data | Object[] | Array of activities |
| &nbsp;&nbsp;id | Number | Activity id |
| &nbsp;&nbsp;property_id | Number | Property id |
| &nbsp;&nbsp;user_id | Number | User id who performed the activity |
| &nbsp;&nbsp;type | String | Activity type. Allowed values: `'status_changed'`, `'price_update'`, `'user_assignment'`, `'data_changed'`, `'category_changed'`, `'delete_property'` |
| &nbsp;&nbsp;field_name | String\|Null | Field name that was changed |
| &nbsp;&nbsp;old_value | String\|Null | Old value |
| &nbsp;&nbsp;old_label | String\|Null | Old value label |
| &nbsp;&nbsp;new_value | String\|Null | New value |
| &nbsp;&nbsp;new_label | String\|Null | New value label |
| &nbsp;&nbsp;comments | String\|Null | Additional comments |
| &nbsp;&nbsp;extra_data | Object\|Null | Additional data related to the activity |
| &nbsp;&nbsp;created_at | String | Creation date |
| &nbsp;&nbsp;updated_at | String | Update date |
| &nbsp;&nbsp;user | Object | User who performed the activity |
| &nbsp;&nbsp;&nbsp;&nbsp;id | Number | User id |
| &nbsp;&nbsp;&nbsp;&nbsp;email | String | User email |
| &nbsp;&nbsp;&nbsp;&nbsp;first_name | String | User first name |
| &nbsp;&nbsp;&nbsp;&nbsp;last_name | String | User last name |
| &nbsp;&nbsp;&nbsp;&nbsp;full_name | String | User full name |
| &nbsp;&nbsp;&nbsp;&nbsp;phone | String\|Null | User phone |
| &nbsp;&nbsp;&nbsp;&nbsp;phone_whatsapp | String\|Null | User WhatsApp phone |
| &nbsp;&nbsp;&nbsp;&nbsp;office_id | Number\|Null | Office id |
| &nbsp;&nbsp;&nbsp;&nbsp;role_id | Number\|Null | Role id |
| &nbsp;&nbsp;&nbsp;&nbsp;avatar | String\|Null | User avatar URL |
| links | Object | Pagination links |
| &nbsp;&nbsp;first | String\|Null | First page URL |
| &nbsp;&nbsp;last | String\|Null | Last page URL |
| &nbsp;&nbsp;prev | String\|Null | Previous page URL |
| &nbsp;&nbsp;next | String\|Null | Next page URL |
| meta | Object | Pagination metadata |
| &nbsp;&nbsp;current_page | Number | Current page number |
| &nbsp;&nbsp;from | Number | First item number in current page |
| &nbsp;&nbsp;last_page | Number | Last page number |
| &nbsp;&nbsp;links | Object[] | Pagination links array |
| &nbsp;&nbsp;path | String | Base path |
| &nbsp;&nbsp;per_page | Number | Items per page |
| &nbsp;&nbsp;to | Number | Last item number in current page |
| &nbsp;&nbsp;total | Number | Total items |

**Success Response (HTTP/2 200 OK)**

```json
{
  "data": [
    {
      "id": 58588,
      "property_id": 456402,
      "user_id": 6901,
      "type": "price_update",
      "field_name": "expenses",
      "old_value": "100000",
      "old_label": "100000",
      "new_value": "0",
      "new_label": "0",
      "comments": null,
      "extra_data": {
        "property_id": 456402,
        "user_full_name": "Juan Perez",
        "currency_new": 2,
        "currency_old": 2
      },
      "created_at": "2025-11-18T17:26:42.000000Z",
      "updated_at": "2025-11-18T17:26:42.000000Z",
      "user": {
        "id": 6901,
        "email": "juan.perez@kiteprop.com",
        "first_name": "Juan",
        "last_name": "Perez",
        "phone": "011-55544411",
        "phone_whatsapp": "+5491155544411",
        "office_id": 2,
        "full_name": "Juan Perez",
        "role_id": 2,
        "avatar": "https://static.kiteprop.com/kp/crm/images/users/lg/1906-ba60f..."
      }
    }
  ],
  "links": {
    "first": "https://www.kiteprop.com/api/v1/properties/456402/activities?page=1",
    "last": "https://www.kiteprop.com/api/v1/properties/456402/activities?page=1",
    "prev": null,
    "next": null
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "links": [
      { "url": null, "label": "&laquo; Anterior", "active": false },
      { "url": "https://www.kiteprop.com/api/v1/properties/456402/activities?page=1", "label": "1", "active": true },
      { "url": null, "label": "Siguiente &raquo;", "active": false }
    ],
    "path": "https://www.kiteprop.com/api/v1/properties/456402/activities",
    "per_page": 15,
    "to": 1,
    "total": 1
  }
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

---

### Properties - List

Properties are paginated and can be filtered.

> Search servers may return cached content of properties details for a few seconds.

```
GET https://www.kiteprop.com/api/v1/properties
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| q (optional) | String | Search by query string |
| type (optional) | String | Property type. Allowed values: `'houses'`, `'apartments'`, `'ph'`, `'offices'`, `'residential_lands'`, `'industrial_lands'`, `'warehouses'`, `'industrial_warehouses'`, `'farms'`, `'parking_spaces'`, `'retail_spaces'`, `'medical_spaces'`, `'cemetery_lots'`, `'businesses'`, `'boat_storages'` |
| status (optional) | String | Property status. Allowed values: `'reserved'`, `'sold'`, `'rented'`, `'suspended'`, `'active'`, `'inactive'`, `'active_unpublished'` |
| op_type (optional) | String | Operation type. Allowed values: `'rental'`, `'sale'`, `'temporary_rental'` |
| currency_id (optional) | Number | Currency id (1=USD, 2=ARS, 6=CLP, 19=UF, 11=EUR). Allowed values: 1, 2, 6, 11, 19 |
| price_min (optional) | Number | Price minimum value |
| price_max (optional) | Number | Price maximum value |
| bedrooms (optional) | Array[Number] | Amount of bedrooms |
| bathrooms (optional) | Array[Number] | Amount of bathrooms |
| parkings (optional) | Array[Number] | Amount of parkings |
| tags (optional) | Array[String] | Tags |
| page (optional) | Number | Page number |
| limit (optional) | Number | Results limit. Allowed values: 15, 30, 50 |
| order (optional) | String | Results order. Allowed values: `'id:asc'`, `'id:desc'`, `'price:asc'`, `'price:desc'` |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| data | Object | |
| &nbsp;&nbsp;id | Number | Property id |
| &nbsp;&nbsp;code | String | Property public code |
| &nbsp;&nbsp;source_id | String | Source identifier (when importing) |
| &nbsp;&nbsp;type | String | Property type |
| &nbsp;&nbsp;status | String | Property status. Allowed values: `'reserved'`, `'sold'`, `'rented'`, `'suspended'`, `'active'`, `'inactive'`, `'active_unpublished'` |
| &nbsp;&nbsp;title | String\|Null | Property title |
| &nbsp;&nbsp;description | String\|Null | Property description |
| &nbsp;&nbsp;images_list | Array | Property images |
| &nbsp;&nbsp;&nbsp;&nbsp;id | Number | Image id |
| &nbsp;&nbsp;&nbsp;&nbsp;title | String\|Null | Image title |
| &nbsp;&nbsp;&nbsp;&nbsp;main | Boolean | Main image flag |
| &nbsp;&nbsp;&nbsp;&nbsp;sm | String | Image url size small |
| &nbsp;&nbsp;&nbsp;&nbsp;md | String | Image url size medium |
| &nbsp;&nbsp;&nbsp;&nbsp;blueprint | Boolean | Is blueprint |
| &nbsp;&nbsp;&nbsp;&nbsp;internal | Boolean | Is private image |
| &nbsp;&nbsp;&nbsp;&nbsp;position | Number\|Null | Order position |
| &nbsp;&nbsp;&nbsp;&nbsp;created_at | String | Creation date |
| &nbsp;&nbsp;&nbsp;&nbsp;updated_at | String | Update date |
| &nbsp;&nbsp;link_youtube | String\|Null | Youtube embed url |
| &nbsp;&nbsp;link_360 | String\|Null | 360º view iframe url |
| &nbsp;&nbsp;country | String\|Null | Country name |
| &nbsp;&nbsp;state | String\|Null | State name |
| &nbsp;&nbsp;city | String\|Null | City name |
| &nbsp;&nbsp;neighborhood | String\|Null | Neighborhood name |
| &nbsp;&nbsp;zone | String\|Null | Zone name |
| &nbsp;&nbsp;postal_code | String\|Null | Postal code |
| &nbsp;&nbsp;address | String\|Null | Property exact address |
| &nbsp;&nbsp;guidance_address | String\|Null | Property guidance address |
| &nbsp;&nbsp;hide_exact_location | Boolean | Property shouldn't show exact location/address |
| &nbsp;&nbsp;geo | Object | Geo location coordinates |
| &nbsp;&nbsp;&nbsp;&nbsp;lat | Float\|Null | Map latitude |
| &nbsp;&nbsp;&nbsp;&nbsp;lng | Float\|Null | Map longitude |
| &nbsp;&nbsp;rooms | Number\|Null | Number of rooms |
| &nbsp;&nbsp;bedrooms | Number\|Null | Number of bedrooms |
| &nbsp;&nbsp;bathrooms | Number\|Null | Number of bathrooms |
| &nbsp;&nbsp;half_bathrooms | Number\|Null | Number of half bathrooms |
| &nbsp;&nbsp;parkings | Number\|Null | Number of parkings |
| &nbsp;&nbsp;floors_in_building | Number\|Null | Total number of floors in the building / property |
| &nbsp;&nbsp;floor | Number\|Null | Number of floor |
| &nbsp;&nbsp;total_meters | Number\|Null | Total meters m² |
| &nbsp;&nbsp;covered_meters | Number\|Null | Covered meters m² |
| &nbsp;&nbsp;uncovered_meters | Number\|Null | Uncovered meters m² |
| &nbsp;&nbsp;terrain_size | Number\|Null | Terrain size m² |
| &nbsp;&nbsp;front_meters | Number\|Null | Terrain meters for front side |
| &nbsp;&nbsp;side_meters | Number\|Null | Terrain meters for rear side |
| &nbsp;&nbsp;year_built | Number\|Null | Year built |
| &nbsp;&nbsp;is_new_construction | Boolean\|Null | Is a new construction |
| &nbsp;&nbsp;delivery_date | String\|Null | Delivery date |
| &nbsp;&nbsp;fit_for_credit | Boolean\|Null | Fit for credit |
| &nbsp;&nbsp;accept_barter | Boolean\|Null | Accept barter/permute |
| &nbsp;&nbsp;accept_pets | Boolean\|Null | Accept pets |
| &nbsp;&nbsp;currency | String | Currency code |
| &nbsp;&nbsp;expenses_currency | String | Expenses currency code |
| &nbsp;&nbsp;hide_prices | Boolean | Hide prices |
| &nbsp;&nbsp;for_sale | Boolean | Is for sale |
| &nbsp;&nbsp;for_sale_price | Float\|Null | Sale price |
| &nbsp;&nbsp;for_rent | Boolean | Is for rent |
| &nbsp;&nbsp;for_rent_price | Float\|Null | Rental price |
| &nbsp;&nbsp;for_temp_rental | Boolean | Is for temporary rental |
| &nbsp;&nbsp;for_temp_rental_price_day | Float\|Null | Daily temporary rental price |
| &nbsp;&nbsp;for_temp_rental_price_week | Float\|Null | Weekly temporary rental price |
| &nbsp;&nbsp;for_temp_rental_price_month | Float\|Null | Monthly temporary rental price |
| &nbsp;&nbsp;expenses | String\|Null | Expenses price/info |
| &nbsp;&nbsp;tags | Array[String] | Internal tags |
| &nbsp;&nbsp;created_at | String | Creation date |
| &nbsp;&nbsp;updated_at | String | Update date |
| pagination | Object | |
| &nbsp;&nbsp;per_page | Number | Results per page |
| &nbsp;&nbsp;current_page | Number | Current page |
| &nbsp;&nbsp;last_page | Number | Last page |
| &nbsp;&nbsp;total | Number | Total pages |

**Success Response (HTTP/2 200 OK)**

```json
{
  "data": [
    {
      "id": 75052,
      "code": "KP75052",
      "internal_id": "ME4349_28",
      "source_id": "TV-493391-22",
      "type": "houses",
      "status": "active",
      "title": "Roldán tierras de sueños 2",
      "description": "Casa a estrenar, en planta baja living comedor, cocina separada...",
      "images_list": [
        {
          "title": null,
          "main": true,
          "sm": "https://static.kiteprop.com/kp/properties/75052/e9234b/sm/e9...",
          "md": "https://static.kiteprop.com/kp/properties/75052/e9234b/md/e9..."
        },
        {
          "title": null,
          "main": false,
          "sm": "https://static.kiteprop.com/kp/properties/75052/646946/sm/64...",
          "md": "https://static.kiteprop.com/kp/properties/75052/646946/md/64..."
        }
      ],
      "link_youtube": "https://www.youtube.com/watch?v=UMqVEV6cOaw",
      "link_360": "https://my.matterport.com/show/?m=Ez3YDocMaVx",
      "country": "Argentina",
      "state": "Santa Fe",
      "city": "Funes",
      "neighborhood": "Funes City",
      "zone": null,
      "postal_code": "S2132",
      "address": "Av. San Martín 8455",
      "guidance_address": "Av. San Martín 8400",
      "hide_exact_location": true,
      "geo": {
        "lat": -32.9307106,
        "lon": -60.8914057
      },
      "rooms": 4,
      "bedrooms": 2,
      "bathrooms": 3,
      "half_bathrooms": 1,
      "parkings": 2,
      "floors_in_building": null,
      "floor": null,
      "total_meters": 215,
      "covered_meters": 135,
      "uncovered_meters": 215,
      "terrain_size": 350,
      "front_meters": 10,
      "side_meters": 35,
      "year_built": 2015,
      "is_new_construction": false,
      "delivery_date": null,
      "fit_for_credit": false,
      "accept_barter": true,
      "accept_pets": true,
      "currency": "usd",
      "expenses_currency": "usd",
      "hide_prices": false,
      "for_sale": true,
      "for_sale_price": 170000.5,
      "for_rent": false,
      "for_rent_price": null,
      "for_temp_rental": false,
      "for_temp_rental_price_day": null,
      "for_temp_rental_price_week": null,
      "for_temp_rental_price_month": null,
      "expenses": null,
      "tags": ["funes"],
      "created_at": "2022-03-06T01:23:28.000000Z",
      "updated_at": "2022-03-06T01:23:28.000000Z",
      "user": {
        "id": 3147,
        "email": "juan@email.com",
        "phone": "+541160000000",
        "phone_whatsapp": "+541160000001",
        "full_name": "Juan Perez"
      }
    }
  ],
  "pagination": {
    "from": null,
    "to": null,
    "per_page": 15,
    "current_page": 2,
    "last_page": 92,
    "total": 1378,
    "path": "https://www.kiteprop.com/api/v1/properties",
    "first_page_url": "https://www.kiteprop.com/api/v1/properties?page=1",
    "last_page_url": "https://www.kiteprop.com/api/v1/properties?page=92",
    "next_page_url": "https://www.kiteprop.com/api/v1/properties?page=3",
    "prev_page_url": "https://www.kiteprop.com/api/v1/properties?page=1",
    "links": []
  }
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

---

### Properties - Show

> Search servers may return cached content of properties details for a few seconds.

```
GET https://www.kiteprop.com/api/v1/properties/{id}
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

The response structure is identical to Properties - List, but returns a single `data` object (not an array) with the `success` and `errorMessage` envelope.

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 75052,
    "code": "KP75052",
    "internal_id": "ME4349_28",
    "source_id": "TV-493391-22",
    "type": "houses",
    "status": "active",
    "title": "Roldán tierras de sueños 2",
    "description": "Casa a estrenar, en planta baja living comedor, cocina separada...",
    "images_list": [
      {
        "id": 4385527,
        "title": "Frente de la casa",
        "main": true,
        "blueprint": false,
        "internal": false,
        "position": 0,
        "updated_at": "2025-11-14T18:11:22.000000Z",
        "created_at": "2025-11-14T18:02:45.000000Z",
        "sm": "https://static.kiteprop.com/kp/properties/75052/695182/sm/695182...",
        "md": "https://static.kiteprop.com/kp/properties/75052/695182/md/695182...",
        "lg": "https://static.kiteprop.com/kp/properties/75052/695182/lg/695182..."
      },
      {
        "id": 4385501,
        "title": null,
        "main": false,
        "blueprint": false,
        "internal": false,
        "position": 1,
        "updated_at": "2025-11-14T18:11:22.000000Z",
        "created_at": "2025-11-14T18:01:53.000000Z",
        "sm": "https://static.kiteprop.com/kp/properties/75052/96b7c0/sm/96b7c0...",
        "md": "https://static.kiteprop.com/kp/properties/75052/96b7c0/md/96b7c0...",
        "lg": "https://static.kiteprop.com/kp/properties/75052/96b7c0/lg/96b7c0..."
      }
    ],
    "link_youtube": "https://www.youtube.com/watch?v=UMqVEV6cOaw",
    "link_360": "https://my.matterport.com/show/?m=Ez3YDocMaVx",
    "country": "Argentina",
    "state": "Santa Fe",
    "city": "Funes",
    "neighborhood": "Funes City",
    "zone": null,
    "postal_code": "S2132",
    "address": "Av. San Martín 8455",
    "guidance_address": "Av. San Martín 8400",
    "hide_exact_location": true,
    "geo": {
      "lat": -32.9307106,
      "lon": -60.8914057
    },
    "rooms": 4,
    "bedrooms": 2,
    "bathrooms": 3,
    "half_bathrooms": 1,
    "parkings": 2,
    "floors_in_building": null,
    "floor": null,
    "total_meters": 215,
    "covered_meters": 135,
    "uncovered_meters": 215,
    "terrain_size": 350,
    "front_meters": 10,
    "side_meters": 35,
    "year_built": 2015,
    "is_new_construction": false,
    "delivery_date": null,
    "fit_for_credit": false,
    "accept_barter": true,
    "accept_pets": true,
    "currency": "usd",
    "expenses_currency": "usd",
    "hide_prices": false,
    "for_sale": true,
    "for_sale_price": 170000.5,
    "for_rent": false,
    "for_rent_price": null,
    "for_temp_rental": false,
    "for_temp_rental_price_day": null,
    "for_temp_rental_price_week": null,
    "for_temp_rental_price_month": null,
    "expenses": null,
    "tags": ["funes"],
    "created_at": "2022-03-06T01:23:28.000000Z",
    "updated_at": "2022-03-06T01:23:28.000000Z",
    "user": {
      "id": 3147,
      "email": "juan@email.com",
      "phone": "+541160000000",
      "phone_whatsapp": "+541160000001",
      "full_name": "Juan Perez"
    }
  }
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

**Not Found (HTTP/2 404)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Property not found",
  "details": []
}
```

---

### Properties - Update

Updates a property.

```
PUT https://www.kiteprop.com/api/v1/properties/{id}
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

> Accepts the same body parameters as Properties - Create. Send only the fields you wish to update.

---

## Properties Difusions

### Properties_Difusions - Difusions Report

Returns a paginated report of difusion statuses for properties. Each item includes main property difusion info (all portals) and optional clones.

```
GET https://www.kiteprop.com/api/v1/difusions/report
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Query**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| status (optional) | String | Filter by property status (e.g. `active`). |
| page (optional) | Number | Page number for pagination. Default: 1 |
| limit (optional) | Number | Items per page for pagination. Default: 50 |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| data | Object[] | List of properties with difusion information (paginated). |
| &nbsp;&nbsp;property_id | Number | Internal property ID. |
| &nbsp;&nbsp;property_code | String | Internal property code (e.g. `KP461363`). |
| &nbsp;&nbsp;property_status | String | Property status (e.g. `active`). |
| &nbsp;&nbsp;property | Object | Difusion info per portal. For each portal (`argenprop`, `bienesonline`, `bienesrosario`, `cabaprop`, `doomos`, `lavoz`, `mercadolibre`, `mitula`, `properati`, `properstar`, `propia`, `proppit`, `terrenosyquintas`, `yumblin`, `zonaprop`, etc.): `portal_id`, `portal_url`, `portal_last_error`, `portal_last_post`, `portal_last_remove`, `portal_last_update` (nullable strings). Also `site_visits` (Number), `old_ids` (Object with arrays per portal). |
| &nbsp;&nbsp;clones | Object[] | Array of cloned properties with same structure (may be empty). |
| links | Object | Pagination links. |
| &nbsp;&nbsp;first | String | URL of first page. |
| &nbsp;&nbsp;last | String | URL of last page. |
| &nbsp;&nbsp;prev | String\|null | URL of previous page. |
| &nbsp;&nbsp;next | String\|null | URL of next page. |
| meta | Object | Pagination and summary metadata. |
| &nbsp;&nbsp;current_page | Number | Current page number. |
| &nbsp;&nbsp;from | Number | Index of first item on current page. |
| &nbsp;&nbsp;last_page | Number | Last page number. |
| &nbsp;&nbsp;per_page | Number | Items per page. |
| &nbsp;&nbsp;path | String | Base path of the endpoint. |
| &nbsp;&nbsp;to | Number | Index of last item on current page. |
| &nbsp;&nbsp;total | Number | Total number of items. |
| &nbsp;&nbsp;sending | Object | Count of properties currently sending per portal (`mercadolibre`, `argenprop`, `zonaprop`, `properstar`, etc.). |

**Success Response**

```json
{
  "data": [
    {
      "property_id": 461363,
      "property_code": "KP461363",
      "property_status": "active",
      "property": {
        "argenprop_id": null,
        "argenprop_last_error": "API response error: ...",
        "argenprop_last_update": "2026-01-15 03:41:32",
        "mercadolibre_id": "MLA1608064167",
        "mercadolibre_url": "https://articulo.mercadolibre.com.ar/MLA-1608064167-...",
        "properstar_id": "https://dashboard.properstar.com/s/?accountId=6304561&listingId=...",
        "properstar_last_update": "2026-01-15 09:45:17",
        "zonaprop_id": null,
        "site_visits": 76,
        "old_ids": { "mercadolibre": [] }
      },
      "clones": []
    }
  ],
  "links": {
    "first": "https://local.kiteprop.com/api/v1/difusions/report?page=1",
    "last": "https://local.kiteprop.com/api/v1/difusions/report?page=10",
    "prev": "https://local.kiteprop.com/api/v1/difusions/report?page=2",
    "next": "https://local.kiteprop.com/api/v1/difusions/report?page=4"
  },
  "meta": {
    "current_page": 3,
    "from": 31,
    "last_page": 10,
    "per_page": 15,
    "to": 45,
    "total": 139,
    "sending": {
      "mercadolibre": 86,
      "argenprop": 84,
      "properstar": 84,
      "yumblin": 84
    }
  }
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Internal server error",
  "details": []
}
```

---

### Properties_Difusions - Difusions Results

Returns publication status information for a property and its clones on external portals (e.g., Argenprop, Zonaprop, MercadoLibre).

```
GET https://www.kiteprop.com/api/v1/difusions/properties/{id}/results
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | Number | Property internal ID. |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Indicates if the request was successful. |
| data | Object | Response payload. |
| &nbsp;&nbsp;property | Object | Main property's difusion results. |
| &nbsp;&nbsp;&nbsp;&nbsp;property_id | Number | Property id. |
| &nbsp;&nbsp;&nbsp;&nbsp;property_code | String | Property code. |
| &nbsp;&nbsp;&nbsp;&nbsp;vendor_id | String\|null | Vendor external item id. |
| &nbsp;&nbsp;&nbsp;&nbsp;vendor_url | String\|null | Vendor external item url. |
| &nbsp;&nbsp;&nbsp;&nbsp;vendor_last_error | String\|null | Vendor error reason. |
| &nbsp;&nbsp;&nbsp;&nbsp;vendor_last_post | String\|null | Vendor last post date. |
| &nbsp;&nbsp;&nbsp;&nbsp;vendor_last_update | String\|null | Vendor last update date. |
| &nbsp;&nbsp;&nbsp;&nbsp;vendor_last_remove | String\|null | Vendor last remove date. |
| &nbsp;&nbsp;clones | Array | Cloned properties (same structure as property). |

**Success Response**

```json
{
  "success": true,
  "data": {
    "property": {
      "property_id": 12345,
      "properstar_id": "P391245",
      "properstar_last_error": null,
      "properstar_last_update": "2025-04-23 05:54:31",
      "properstar_url": "https://dashboard.properstar.com/s/?accountId=6304561&listingId=..."
    },
    "clones": {
      "property": {
        "property_id": 56789,
        "argenprop_id": null,
        "argenprop_url": null,
        "argenprop_last_error": "La propiedad tiene precios invalidos",
        "argenprop_last_update": "2025-04-22 04:51:39",
        "mercadolibre_last_error": null,
        "mercadolibre_last_remove": null,
        "mercadolibre_last_post": "2025-04-22 04:51:39",
        "mercadolibre_last_update": "2025-04-22 04:51:39",
        "mercadolibre_id": "MLC1588696081",
        "mercadolibre_url": "https://articulo.mercadolibre.cl/MLC-1588696081-..."
      }
    }
  }
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

---

### Properties_Difusions - Manage Difusions

You must have pre-linked the difusion providers. Please reach support to get information to feature your difusions in the sites.

```
PUT https://www.kiteprop.com/api/v1/difusions/properties/{id}
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| vendors | Object | List of difusion sites to enable or disable difusions. |
| &nbsp;&nbsp;mercadolibre | Boolean\|Number | Enable in MercadoLibre. |
| &nbsp;&nbsp;proppit | Boolean\|Number | Enable in Proppit. |
| &nbsp;&nbsp;zonaprop | Boolean\|Number | Enable in ZonaProp. |
| &nbsp;&nbsp;argenprop | Boolean\|Number | Enable in Argenprop. |
| &nbsp;&nbsp;doomos | Boolean\|Number | Enable in Doomos. |
| &nbsp;&nbsp;goplaceit | Boolean\|Number | Enable in GoPlaceIt. |
| &nbsp;&nbsp;melrom | Boolean\|Number | Enable in Melrom. |
| &nbsp;&nbsp;propia | Boolean\|Number | Enable in Propia. |
| &nbsp;&nbsp;toctoc | Boolean\|Number | Enable in TocToc. |
| &nbsp;&nbsp;yapo | Boolean\|Number | Enable in Yapo. |
| &nbsp;&nbsp;bienesrosario | Boolean\|Number | Enable in Bienes Rosario. |
| &nbsp;&nbsp;chilepropiedades | Boolean\|Number | Enable in Chile Propiedades. |
| &nbsp;&nbsp;portalterreno | Boolean\|Number | Enable in Portal Terreno. |
| &nbsp;&nbsp;argentinavende | Boolean\|Number | Enable in Argentina Vende. |
| &nbsp;&nbsp;cabaprop | Boolean\|Number | Enable in CABAProp. |
| &nbsp;&nbsp;yumblin | Boolean\|Number | Enable in Yumblin. |
| &nbsp;&nbsp;bienesonline | Boolean\|Number | Enable in BienesOnline. |
| &nbsp;&nbsp;lacapital | Boolean\|Number | Enable in La Capital. |
| &nbsp;&nbsp;enlaceinmobiliario | Boolean\|Number | Enable in Enlace Inmobiliario. |
| &nbsp;&nbsp;flexy | Boolean\|Number | Enable in Flexy. |
| &nbsp;&nbsp;properstar | Boolean\|Number | Enable in Properstar. |
| zonaprop_location_id (optional) | String\|null | Zonaprop custom location ID. |
| zonaprop_featured_type (optional) | String\|null | Zonaprop featured type. |
| zonaprop_property_subtype_id (optional) | Number\|null | Zonaprop custom sub type. |
| mercadolibre_featured_type (optional) | String\|null | MercadoLibre featured type. |
| mercadolibre_category_id (optional) | String\|null | MercadoLibre custom category ID. |
| argenprop_location_id (optional) | String\|null | Argenprop custom location ID. |
| lacapital_newspaper_body (optional) | String\|null | LaCapital paper body to be printed. |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | |
| data | Object | |
| &nbsp;&nbsp;olx | Boolean | Active in OLX. |
| &nbsp;&nbsp;zonaprop | Boolean | Active in ZonaProp. |
| &nbsp;&nbsp;mercadolibre | Boolean | Active in MercadoLibre. |
| &nbsp;&nbsp;argenprop | Boolean | Active in Argenprop. |
| &nbsp;&nbsp;doomos | Boolean | Active in Doomos. |
| &nbsp;&nbsp;goplaceit | Boolean | Active in GoPlaceIt. |
| &nbsp;&nbsp;melrom | Boolean | Active in Melrom. |
| &nbsp;&nbsp;propia | Boolean | Active in Propia. |
| &nbsp;&nbsp;toctoc | Boolean | Active in TocToc. |
| &nbsp;&nbsp;yapo | Boolean | Active in Yapo. |
| &nbsp;&nbsp;bienesrosario | Boolean | Active in Bienes Rosario. |
| &nbsp;&nbsp;chilepropiedades | Boolean | Active in Chile Propiedades. |
| &nbsp;&nbsp;portalterreno | Boolean | Active in Portal Terreno. |
| &nbsp;&nbsp;argentinavende | Boolean | Active in Argentina Vende. |
| &nbsp;&nbsp;cabaprop | Boolean | Active in CABAProp. |
| &nbsp;&nbsp;yumblin | Boolean | Active in Yumblin. |
| &nbsp;&nbsp;bienesonline | Boolean | Active in BienesOnline. |
| &nbsp;&nbsp;lacapital | Boolean | Active in La Capital. |
| &nbsp;&nbsp;enlaceinmobiliario | Boolean | Active in Enlace Inmobiliario. |
| &nbsp;&nbsp;proppit | Boolean | Active in Proppit. |
| &nbsp;&nbsp;flexy | Boolean | Active in Flexy. |
| &nbsp;&nbsp;properstar | Boolean | Active in Properstar. |
| &nbsp;&nbsp;zonaprop_location_id | String\|null | Zonaprop custom location ID. |
| &nbsp;&nbsp;zonaprop_featured_type | String\|null | Zonaprop featured type. |
| &nbsp;&nbsp;zonaprop_property_subtype_id | Number\|null | Zonaprop featured type. |
| &nbsp;&nbsp;mercadolibre_featured_type | String\|null | MercadoLibre featured type. |
| &nbsp;&nbsp;mercadolibre_category_id | String\|null | MercadoLibre custom category ID. |
| &nbsp;&nbsp;argenprop_location_id | String\|null | Argenprop custom location ID. |
| &nbsp;&nbsp;lacapital_newspaper_body | String\|null | LaCapital paper body to be printed. |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": [
    {
      "mercadolibre": true,
      "proppit": false,
      "zonaprop": false,
      "argenprop": false,
      "doomos": false,
      "goplaceit": false,
      "melrom": false,
      "propia": false,
      "toctoc": false,
      "yapo": false,
      "bienesrosario": false,
      "chilepropiedades": false,
      "portalterreno": false,
      "argentinavende": false,
      "cabaprop": false,
      "bienesonline": true,
      "yumblin": false,
      "lacapital": false,
      "enlaceinmobiliario": false,
      "flexy": false,
      "properstar": false,
      "zonaprop_location_id": "V1-C-1004728",
      "zonaprop_featured_type": "destacado",
      "zonaprop_property_subtype_id": 34,
      "mercadolibre_featured_type": "silver",
      "mercadolibre_category_id": "MLA6414",
      "argenprop_location_id": "c4050",
      "lacapital_newspaper_body": "Texto para ficha en diario LaCapital papel"
    }
  ]
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

---

### Properties_Difusions - Show Difusions

You must have pre-linked the difusion providers.

```
GET https://www.kiteprop.com/api/v1/difusions/properties/{id}
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | |
| data | Object | |
| &nbsp;&nbsp;zonaprop | Boolean | Active in ZonaProp. |
| &nbsp;&nbsp;mercadolibre | Boolean | Active in MercadoLibre. |
| &nbsp;&nbsp;argenprop | Boolean | Active in Argenprop. |
| &nbsp;&nbsp;doomos | Boolean | Active in Doomos. |
| &nbsp;&nbsp;goplaceit | Boolean | Active in GoPlaceIt. |
| &nbsp;&nbsp;propia | Boolean | Active in Propia. |
| &nbsp;&nbsp;toctoc | Boolean | Active in TocToc. |
| &nbsp;&nbsp;yapo | Boolean | Active in Yapo. |
| &nbsp;&nbsp;bienesrosario | Boolean | Active in Bienes Rosario. |
| &nbsp;&nbsp;chilepropiedades | Boolean | Active in Chile Propiedades. |
| &nbsp;&nbsp;portalterreno | Boolean | Active in Portal Terreno. |
| &nbsp;&nbsp;argentinavende | Boolean | Active in Argentina Vende. |
| &nbsp;&nbsp;cabaprop | Boolean | Active in CABAProp. |
| &nbsp;&nbsp;yumblin | Boolean | Active in Yumblin. |
| &nbsp;&nbsp;bienesonline | Boolean | Active in BienesOnline. |
| &nbsp;&nbsp;lacapital | Boolean | Active in La Capital. |
| &nbsp;&nbsp;enlaceinmobiliario | Boolean | Active in Enlace Inmobiliario. |
| &nbsp;&nbsp;proppit | Boolean | Active in Proppit. |
| &nbsp;&nbsp;flexy | Boolean | Active in Flexy. |
| &nbsp;&nbsp;properstar | Boolean | Active in Properstar. |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": [
    {
      "mercadolibre": true,
      "proppit": false,
      "zonaprop": false,
      "argenprop": false,
      "doomos": false,
      "goplaceit": false,
      "melrom": false,
      "propia": false,
      "toctoc": false,
      "yapo": false,
      "bienesrosario": false,
      "chilepropiedades": false,
      "portalterreno": false,
      "argentinavende": false,
      "cabaprop": false,
      "bienesonline": true,
      "yumblin": false,
      "lacapital": false,
      "enlaceinmobiliario": false,
      "flexy": false,
      "properstar": false
    }
  ]
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

---

## Properties Images

### Properties_Images - Delete All Images

Deletes all images from a property. This action is irreversible and will remove all images associated with the property.

```
DELETE https://www.kiteprop.com/api/v1/properties/{propertyId}/images/all
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| propertyId | Number | Property ID (in URL path) |

**Success Response (HTTP/1.1 204 No Content)**

```
HTTP/1.1 204 No Content
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Not Found Response (HTTP/1.1 404 Not Found)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No query results for model [App\\Models\\Property]",
  "details": []
}
```

---

### Properties_Images - Delete Image

Deletes a property image by ID. This action is irreversible.

```
DELETE https://www.kiteprop.com/api/v1/properties/{propertyId}/images/{imageId}
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| propertyId | Number | Property ID (in URL path) |
| imageId | Number | Image ID (in URL path) |

**Success Response (HTTP/1.1 204 No Content)**

```
HTTP/1.1 204 No Content
```

**Not Found Response (HTTP/1.1 404 Not Found)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "La imágen no existe.",
  "details": []
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudo la imagen.",
  "details": []
}
```

---

### Properties_Images - Update Image

Updates an image's metadata (title, position, blueprint flag, internal flag) for a property.

```
PUT https://www.kiteprop.com/api/v1/properties/{propertyId}/images/{imageId}
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| propertyId | Number | Property ID (in URL path) |
| imageId | Number | Image ID (in URL path) |
| title | String | Title of the image. |
| position (optional) | Number | Image position. Lower numbers appear first. Position 0 is the main image. |
| blueprint | Boolean | Image is a blueprint (0 or 1). |
| internal | Boolean | Image is private or for internal use (0 or 1). |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 3728422,
    "property_id": 41457,
    "title": "Planos de la casa",
    "position": 999,
    "internal": false,
    "blueprint": true,
    "url": "https://static.kiteprop.com/kp/properties/41457/fa83e5/lg/fa83e59b36...",
    "updated_at": "2026-01-06T15:30:17.000000Z",
    "created_at": "2025-06-03T11:55:06.000000Z",
    "urls": {
      "lg": "https://static.kiteprop.com/kp/properties/41457/fa83e5/lg/fa83e59...",
      "md": "https://static.kiteprop.com/kp/properties/41457/fa83e5/md/fa83e59...",
      "sm": "https://static.kiteprop.com/kp/properties/41457/fa83e5/sm/fa83e59..."
    }
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Not Found Response (HTTP/2 404)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No query results for model [App\\Models\\PropertyImage]",
  "details": []
}
```

---

### Properties_Images - Update Images Order

Updates the order/position of property images. The first image in the array will be set as the main image (position 0). The order of IDs in the array determines the position of each image.

```
PUT https://www.kiteprop.com/api/v1/properties/{propertyId}/images-order
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| orders | Array[Number] | Array of image IDs in the desired order. The first ID will be position 0 (main image). |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": [
    {
      "id": 4982931,
      "property_id": 41457,
      "title": "Frente de la casa",
      "position": 0,
      "internal": false,
      "blueprint": false,
      "url": "https://static.kiteprop.com/kp/properties/41457/abc123/lg/abc123...",
      "updated_at": "2026-01-06T15:19:03.000000Z",
      "created_at": "2021-01-19T23:01:01.000000Z",
      "urls": {
        "lg": "https://static.kiteprop.com/kp/properties/41457/abc123/lg/abc...",
        "md": "https://static.kiteprop.com/kp/properties/41457/abc123/md/abc...",
        "sm": "https://static.kiteprop.com/kp/properties/41457/abc123/sm/abc..."
      }
    },
    {
      "id": 3728422,
      "property_id": 41457,
      "title": null,
      "position": 1,
      "internal": false,
      "blueprint": false,
      "url": "https://static.kiteprop.com/kp/properties/41457/def456/lg/def456...",
      "updated_at": "2026-01-06T15:19:03.000000Z",
      "created_at": "2021-01-19T23:01:01.000000Z",
      "urls": {
        "lg": "https://static.kiteprop.com/kp/properties/41457/def456/lg/def...",
        "md": "https://static.kiteprop.com/kp/properties/41457/def456/md/def...",
        "sm": "https://static.kiteprop.com/kp/properties/41457/def456/sm/def..."
      }
    },
    {
      "id": 4982963,
      "property_id": 41457,
      "title": "Interior",
      "position": 2,
      "internal": false,
      "blueprint": false,
      "url": "https://static.kiteprop.com/kp/properties/41457/ghi789/lg/ghi789...",
      "updated_at": "2026-01-06T15:19:03.000000Z",
      "created_at": "2021-01-19T23:01:01.000000Z",
      "urls": {
        "lg": "https://static.kiteprop.com/kp/properties/41457/ghi789/lg/ghi...",
        "md": "https://static.kiteprop.com/kp/properties/41457/ghi789/md/ghi...",
        "sm": "https://static.kiteprop.com/kp/properties/41457/ghi789/sm/ghi..."
      }
    }
  ],
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The orders field is required.",
  "details": []
}
```

---

### Properties_Images - Upload Image in Chunks

Uploads an image to a property using chunked upload. This endpoint supports large file uploads by splitting them into chunks. Compatible with Dropzone.js and other chunked upload libraries.

```
POST https://www.kiteprop.com/api/v1/properties/{propertyId}/images/chunks
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| file | File | The image file to upload (multipart/form-data). |
| title (optional) | String | Title of the image. |
| internal (optional) | Boolean | Image is private or for internal use (0 or 1). |
| blueprint (optional) | Boolean | Image is a blueprint (0 or 1). |
| position (optional) | Number | Image position. |

**Success Response — Upload Complete (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 3649054,
    "property_id": 123,
    "title": "Frente de la casa",
    "position": 0,
    "internal": false,
    "blueprint": false,
    "url": "https://static.kiteprop.com/kp/properties/123/abc123/lg/abc123def456..."
  },
  "errorMessage": null
}
```

**Progress Response — Chunk Upload (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "done": 45.5,
    "status": true,
    "upload_id": "abc123def456"
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "The file field is required.",
  "details": []
}
```

---

### Properties_Images - Upload Images

Creates and uploads images to a property.

```
POST https://www.kiteprop.com/api/v1/properties/{propertyId}/images
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| images | Array | List of images. |
| &nbsp;&nbsp;url | String | URL of the image to upload. |
| &nbsp;&nbsp;title (optional) | String | Title of the image. |
| &nbsp;&nbsp;internal (optional) | Boolean | Image is private or for internal use. |
| &nbsp;&nbsp;blueprint (optional) | Boolean | Image is a blueprint. |
| &nbsp;&nbsp;position (optional) | Number | Image position. |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": [
    {
      "id": 3649054,
      "property_id": 345,
      "title": "Frente de la casa",
      "position": 0,
      "internal": false,
      "blueprint": false,
      "url": "https://static.kiteprop.com/kp/properties/345/2b5d8e/lg/2b5d8ebc..."
    },
    {
      "id": 3649055,
      "property_id": 345,
      "title": "Planos de la casa",
      "position": 5,
      "internal": true,
      "blueprint": true,
      "url": "https://static.kiteprop.com/kp/properties/345/2b5d8e/lg/2b5d8ebc..."
    }
  ],
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No estás autorizado a realizar esta acción.",
  "details": []
}
```

**Error Validation Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "La imágen no pudo ser cargada vía url",
  "details": {
    "exception": "Exception",
    "message": "Tipo de imagen no soportado"
  }
}
```

---

## User

### User - List

Retrieve a paginated list of users. You can filter the results by some optional parameters.

```
GET https://www.kiteprop.com/api/v1/users
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Parámetro**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| q (optional) | String | Search query (matches name, email, phone, etc.) |
| page (optional) | Number | Page number for pagination |
| limit (optional) | Number | Number of items per page (allowed values: 5, 10, 15, 20, 25). Range: 1-25 |
| order (optional) | String | Sort order. Allowed values: `"id:asc"`, `"id:desc"` |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| data | Object | |
| &nbsp;&nbsp;id | Number | User id |
| &nbsp;&nbsp;email | String | User email |
| &nbsp;&nbsp;phone | String\|Null | User phone |
| &nbsp;&nbsp;phone_whatsapp | String\|Null | User phone whatsapp |
| &nbsp;&nbsp;office_id | Number | User office id |
| &nbsp;&nbsp;role_id | Number | User role id |
| &nbsp;&nbsp;full_name | String | User name |
| &nbsp;&nbsp;first_name | String | User first name |
| &nbsp;&nbsp;last_name | String\|Null | User last name |
| &nbsp;&nbsp;avatar | String\|Null | User avatar image url |
| errorMessage | String\|Null | Error message |

**Success Response (HTTP/1.1 200 OK)**

```json
{
  "data": [
    {
      "id": 3,
      "email": "usuario@kiteprop.com",
      "first_name": "Juan",
      "last_name": "Dominguez",
      "phone": "5491131444000",
      "phone_whatsapp": "+5491131444578",
      "role_id": 2,
      "office_id": 2,
      "full_name": "Juan Dominguez",
      "avatar": "https://static.kiteprop.com/kp/crm/images/users/lg/3-511b04cbcf06..."
    }
  ],
  "links": {
    "first": "https://www.kiteprop.com/api/v1/users?page=1",
    "last": "https://www.kiteprop.com/api/v1/users?page=1",
    "prev": null,
    "next": null
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "links": [
      { "url": null, "label": "&laquo; Anterior", "active": false },
      { "url": "https://www.kiteprop.com/api/v1/users?page=1", "label": "1", "active": true },
      { "url": null, "label": "Siguiente &raquo;", "active": false }
    ],
    "path": "https://www.kiteprop.com/api/v1/users",
    "per_page": 15,
    "to": 1,
    "total": 1
  }
}
```

**Error Response (HTTP/2 500 Server Error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "No se pudo obtener la lista de usuarios.",
  "details": []
}
```

---

### User - Profile

Show user profile info.

```
GET https://www.kiteprop.com/api/v1/profile
```

**Header**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| X-API-Key | String | Permanent API key (starts with `kp_`) |

**Success 200**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| success | Boolean | Success. |
| data | Object | |
| &nbsp;&nbsp;id | Number | User id |
| &nbsp;&nbsp;email | String | User email |
| &nbsp;&nbsp;phone | String\|Null | User phone |
| &nbsp;&nbsp;phone_whatsapp | String\|Null | User phone whatsapp |
| &nbsp;&nbsp;office_id | Number | User office id |
| &nbsp;&nbsp;role_id | Number | User role id |
| &nbsp;&nbsp;full_name | String | User name |
| &nbsp;&nbsp;first_name | String | User first name |
| &nbsp;&nbsp;last_name | String\|Null | User last name |
| &nbsp;&nbsp;avatar | String\|Null | User avatar image url |
| errorMessage | String\|Null | Error message |

**Success Response (HTTP/2 200 OK)**

```json
{
  "success": true,
  "data": {
    "id": 3,
    "email": "usuario@kiteprop.com",
    "first_name": "Juan",
    "last_name": "Dominguez",
    "phone": "5491131444000",
    "phone_whatsapp": "+5491131444578",
    "role_id": 2,
    "office_id": 2,
    "full_name": "Juan Dominguez",
    "avatar": "https://static.kiteprop.com/kp/crm/images/users/lg/3-511b04cbcf06..."
  },
  "errorMessage": null
}
```

**Error Response (HTTP/2 500 Server error)**

```json
{
  "success": false,
  "data": null,
  "errorMessage": "Unauthenticated.",
  "details": []
}
```

---

*Generated with [apidoc](https://apidocjs.com) 0.29.0 — 2026-04-01T13:45:04.652Z*
