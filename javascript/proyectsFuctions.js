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



  /*FUNCION PARA MOSTRAR COLOR DE LOS BOTONES*/

  function btnSeleccionado(btnClickeado){
    const capturarClase = document.querySelectorAll('.btnContenido');
    capturarClase.forEach(button => button.classList.remove('active'));
    btnClickeado.classList.add('active');
  }