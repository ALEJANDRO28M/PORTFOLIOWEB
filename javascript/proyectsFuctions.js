function mostrarContenido(idContenido) {
    const contenidos = document.querySelectorAll('.contenido-tab');
     
    //FUNCION PARA AGREGAR CLASS OCULTO Y OCULTAR ELEMENTOS
    contenidos.forEach(contenido => contenido.classList.add('oculto'));

    //FUNCION PARA ELIMINAR CLASS OCULTO Y MOSTRAR ELEMENTOS

    const contenidoSelecciondo = document.getElementById(idContenido);

    contenidoSelecciondo.classList.remove('oculto');


  }
  



  /*
    contenidos.forEach(contenido => contenido.classList.add('oculto'));
  
    const contenidoSeleccionado = document.getElementById(idContenido);
    contenidoSeleccionado.classList.remove('oculto');
  */