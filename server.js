const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json());

// Base de datos
const db = new Database("./database/inventario.db");

// Crear tabla si no existe
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

// Crea tabla Ventas
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

// Crea tabla venta detalles
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

// Endpoint: crear producto
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

// Endpoint: listar productos
app.get("/api/productos", (req, res) => {
  const productos = db.prepare("SELECT * FROM productos").all();
  res.json(productos);
});

// Endpoint: actualizar producto
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

// Eliminar productos
app.delete("/api/productos/:id", (req, res) => {
  const { id } = req.params;

  const stmt = db.prepare("DELETE FROM productos WHERE id = ?");
  const result = stmt.run(id);

  res.json({ success: true, deleted: result.changes });
});

// Obtener productos del inventario
app.get("/api/inventario", (req, res) => {
  try {
    const productos = db.prepare("SELECT * FROM productos").all();
    res.json(productos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cargando inventario" });
  }
});

// Endpoint Ventas
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

// Endpoint ventas
app.get("/api/ventas", (req, res) => {
  try {
    const ventas = db.prepare("SELECT * FROM ventas ORDER BY id DESC").all();
    res.json(ventas);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener ventas" });
  }
});

// Endpoint Dashboard
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

// ------------ PUERTO PARA AZURE ----------
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Servidor ejecutándose en el puerto ${port}`);
});
