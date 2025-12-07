const express = require("express");
const cors = require("cors");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json());

// ================================
// CREAR CARPETA Y BASE SI NO EXISTEN
// ================================

// Crear carpeta database si no existe
if (!fs.existsSync("./database")) {
  fs.mkdirSync("./database");
  console.log("Carpeta 'database' creada.");
}

// Crear archivo inventario.db si no existe
if (!fs.existsSync("./database/inventario.db")) {
  fs.writeFileSync("./database/inventario.db", "");
  console.log("Base de datos 'inventario.db' creada.");
}

// Base de datos
const db = new Database("./database/inventario.db");


// ============================================
// CREACIÓN DE TABLAS
// ============================================

// Tabla productos
db.prepare(`
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT,
    nombre TEXT,
    categoria TEXT,
    subcategoria TEXT,
    precioCompra REAL,
    precioVenta REAL,
    cantidad INTEGER,
    color TEXT,
    marca TEXT,
    descripcion TEXT
  )
`).run();

// Tabla Ventas
db.prepare(`
  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    nombreCliente TEXT,
    apellidosCliente TEXT,
    cedulaCliente TEXT,
    direccionCliente TEXT,
    total REAL
  )
`).run();

// Tabla Detalles de Venta
db.prepare(`
  CREATE TABLE IF NOT EXISTS ventas_detalles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ventaId INTEGER,
    productoId INTEGER,
    nombreProducto TEXT,
    precio REAL,
    cantidad INTEGER,
    subtotal REAL,
    FOREIGN KEY (ventaId) REFERENCES ventas(id),
    FOREIGN KEY (productoId) REFERENCES productos(id)
  )
`).run();

// Tabla Proveedores
db.prepare(`
  CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    email TEXT
  )
`).run();

// Tabla Pedidos
db.prepare(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    precioCompra REAL,
    precioVenta REAL,
    productoId INTEGER,
    proveedorId INTEGER,
    cantidad INTEGER,
    FOREIGN KEY (productoId) REFERENCES productos(id),
    FOREIGN KEY (proveedorId) REFERENCES proveedores(id)
  )
`).run();


// ============================================
// ENDPOINTS PRODUCTOS
// ============================================

// Crear producto
app.post("/api/productos", (req, res) => {
  const {
    sku, nombre, categoria, subcategoria,
    precioCompra, precioVenta, cantidad,
    color, marca, descripcion
  } = req.body;

  const stmt = db.prepare(`
    INSERT INTO productos (
      sku, nombre, categoria, subcategoria,
      precioCompra, precioVenta, cantidad,
      color, marca, descripcion
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    sku, nombre, categoria, subcategoria,
    precioCompra, precioVenta, cantidad,
    color, marca, descripcion
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// Listar productos
app.get("/api/productos", (req, res) => {
  const productos = db.prepare("SELECT * FROM productos").all();
  res.json(productos);
});

// Actualizar producto
app.put("/api/productos/:id", (req, res) => {
  const { id } = req.params;
  const { precioCompra, precioVenta, cantidad } = req.body;

  const stmt = db.prepare(`
    UPDATE productos
    SET precioCompra = ?, precioVenta = ?, cantidad = ?
    WHERE id = ?
  `);

  stmt.run(precioCompra, precioVenta, cantidad, id);

  res.json({ success: true });
});

// Eliminar producto
app.delete("/api/productos/:id", (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare("DELETE FROM productos WHERE id = ?");
  const result = stmt.run(id);
  res.json({ success: true, deleted: result.changes });
});

// Listar inventario
app.get("/api/inventario", (req, res) => {
  try {
    const productos = db.prepare("SELECT * FROM productos").all();
    res.json(productos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cargando inventario" });
  }
});


// ============================================
// ENDPOINTS VENTAS
// ============================================

// Registrar venta
app.post("/api/ventas", (req, res) => {
  try {
    const { cliente, detalles, total, fecha } = req.body;

    if (!cliente || !detalles || detalles.length === 0) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const stmtVenta = db.prepare(`
      INSERT INTO ventas (fecha, nombreCliente, apellidosCliente, cedulaCliente, direccionCliente, total)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const ventaResult = stmtVenta.run(
      fecha,
      cliente.nombre,
      cliente.apellidos,
      cliente.cedula,
      cliente.direccion,
      total
    );

    const ventaId = ventaResult.lastInsertRowid;

    const stmtDetalle = db.prepare(`
      INSERT INTO ventas_detalles (ventaId, productoId, cantidad, precio, subtotal)
      VALUES (?, ?, ?, ?, ?)
    `);

    const stmtDescontar = db.prepare(`
      UPDATE productos SET cantidad = cantidad - ?
      WHERE id = ?
    `);

    detalles.forEach((d) => {
      stmtDetalle.run(ventaId, d.id, d.cantidad, d.precio, d.subtotal);
      stmtDescontar.run(d.cantidad, d.id);
    });

    return res.json({ mensaje: "Venta registrada", ventaId });

  } catch (err) {
    console.error("Error al registrar venta:", err);
    return res.status(500).json({ error: "Error interno al registrar venta" });
  }
});

// Listar ventas
app.get("/api/ventas", (req, res) => {
  try {
    const ventas = db.prepare("SELECT * FROM ventas ORDER BY id DESC").all();
    res.json(ventas);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener ventas" });
  }
});


// ============================================
// ENDPOINT DASHBOARD
// ============================================

app.get("/api/dashboard-subcategorias", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        p.subcategoria AS producto,
        strftime('%m', v.fecha) AS mes_num,
        strftime('%Y', v.fecha) AS anio,
        SUM(d.cantidad) AS ventas_totales,
        AVG(d.precio) AS precio_promedio_venta,
        AVG(p.precioCompra) AS precio_promedio_compra
      FROM ventas_detalles d
      JOIN productos p ON d.productoId = p.id
      JOIN ventas v ON d.ventaId = v.id
      GROUP BY p.subcategoria, mes_num, anio
      ORDER BY anio, mes_num;
    `).all();

    const meses = {
      "01": "Enero", "02": "Febrero", "03": "Marzo",
      "04": "Abril", "05": "Mayo", "06": "Junio",
      "07": "Julio", "08": "Agosto", "09": "Septiembre",
      "10": "Octubre", "11": "Noviembre", "12": "Diciembre"
    };

    const jsonFinal = rows.map(r => {
      const utilidadUnidad = r.precio_promedio_venta - r.precio_promedio_compra;
      return {
        producto: r.producto,
        mes: meses[r.mes_num],
        ventas: r.ventas_totales,
        precio: Number(r.precio_promedio_venta.toFixed(2)),
        ingresos: Number((utilidadUnidad * r.ventas_totales).toFixed(2))
      };
    });

    res.json(jsonFinal);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error generando datos del dashboard" });
  }
});

// ============================================
// ENDPOINT RESUMEN DE VENTAS
// ============================================

app.get("/api/ventas-resumen", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        v.id AS ventaId,
        v.nombreCliente || ' ' || v.apellidosCliente AS cliente,
        v.total,
        v.fecha
      FROM ventas v
      ORDER BY v.id DESC
    `).all();

    res.json(rows);

  } catch (err) {
    console.error("Error al obtener resumen de ventas:", err);
    res.status(500).json({ error: "Error interno al obtener resumen de ventas" });
  }
});

// ============================================
// ENDPOINT DETALLE DE UNA VENTA
// ============================================

app.get("/api/ventas-detalle/:id", (req, res) => {
  try {
    const { id } = req.params;

    const rows = db.prepare(`
      SELECT
        d.id AS detalleId,
        p.sku,
        p.nombre,
        d.cantidad,
        d.precio,
        d.subtotal
      FROM ventas_detalles d
      JOIN productos p ON d.productoId = p.id
      WHERE d.ventaId = ?
      ORDER BY d.id ASC
    `).all(id);

    res.json(rows);

  } catch (err) {
    console.error("Error al obtener detalle de venta:", err);
    res.status(500).json({ error: "Error interno al obtener detalle de venta" });
  }
});


// ============================================
// ENDPOINTS PROVEEDORES
// ============================================

// Crear proveedor
app.post("/api/proveedores", (req, res) => {
  try {
    const { nombre, telefono, email } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "El nombre del proveedor es obligatorio" });
    }

    const stmt = db.prepare(`
      INSERT INTO proveedores (nombre, telefono, email)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(nombre, telefono, email);

    res.json({ success: true, id: result.lastInsertRowid });

  } catch (err) {
    console.error("Error al agregar proveedor:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Listar proveedores
app.get("/api/proveedores", (req, res) => {
  try {
    const proveedores = db.prepare("SELECT * FROM proveedores").all();
    res.json(proveedores);
  } catch (err) {
    console.error("Error al obtener proveedores:", err);
    res.status(500).json({ error: "Error interno al obtener proveedores" });
  }
});

// Elimina proveedores 
app.delete("/api/proveedores/:id", (req, res) => {
  try {
    const { id } = req.params;

    const stmt = db.prepare("DELETE FROM proveedores WHERE id = ?");
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Proveedor no encontrado" });
    }

    res.json({ success: true, deleted: result.changes });
    
  } catch (err) {
    console.error("Error eliminando proveedor:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ============================================
// ENDPOINTS PEDIDOS
// ============================================

// Registrar pedido
app.post("/api/pedidos", (req, res) => {
  try {
    const { fecha, precioCompra, precioVenta, productoId, proveedorId, cantidad } = req.body;

    if (!productoId || !proveedorId || !cantidad) {
      return res.status(400).json({ error: "Datos incompletos para registrar pedido" });
    }

    const stmt = db.prepare(`
      INSERT INTO pedidos (fecha, precioCompra, precioVenta, productoId, proveedorId, cantidad)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      fecha || new Date().toISOString(),
      precioCompra,
      precioVenta,
      productoId,
      proveedorId,
      cantidad
    );

    res.json({ success: true, id: result.lastInsertRowid });

  } catch (err) {
    console.error("Error al registrar pedido:", err);
    res.status(500).json({ error: "Error interno al registrar pedido" });
  }
});

// Obtener detalles de pedidos
app.get("/api/pedidos-detalle", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        p.id AS pedidoId,
        prod.nombre AS producto,
        prov.nombre AS proveedor,
        p.cantidad,
        p.precioCompra
      FROM pedidos p
      JOIN productos prod ON p.productoId = prod.id
      JOIN proveedores prov ON p.proveedorId = prov.id
      ORDER BY p.id DESC
    `).all();

    res.json(rows);

  } catch (err) {
    console.error("Error al obtener detalles de pedidos:", err);
    res.status(500).json({ error: "Error interno al obtener pedidos" });
  }
});


// =================================================
// PUERTO
// =================================================

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Servidor ejecutándose en el puerto ${port}`);
});
